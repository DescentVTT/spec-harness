import { describe, expect, it } from 'vitest';

import { decodeEntities, readJUnit, type JUnitCase } from '../../src/junit.js';

function cases(xml: string): readonly JUnitCase[] {
  const read = readJUnit(xml);
  if (!read.ok) throw new Error(read.error);
  return read.cases;
}

function refusal(xml: string): string {
  const read = readJUnit(xml);
  if (read.ok) throw new Error('read an unreadable report');
  return read.error;
}

describe('reports as the runners write them', () => {
  it('reads a Vitest report', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8" ?>',
      '<testsuites name="vitest tests" tests="2" failures="1" errors="0" time="0.1">',
      '    <testsuite name="tests/probes/rotate.test.ts" timestamp="2026-09-26T00:00:00" hostname="h" tests="2" failures="1" errors="0" skipped="0" time="0.01">',
      '        <testcase classname="tests/probes/rotate.test.ts" name="rotation &gt; rejects the old token" time="0.004">',
      '            <failure message="expected 401, got 200" type="AssertionError">',
      'AssertionError: expected 401, got 200',
      ' ❯ tests/probes/rotate.test.ts:5:3',
      '            </failure>',
      '        </testcase>',
      '        <testcase classname="tests/probes/rotate.test.ts" name="rotation &gt; issues a token" time="0.001">',
      '        </testcase>',
      '    </testsuite>',
      '</testsuites>',
    ].join('\n');
    expect(cases(xml)).toEqual([
      {
        name: 'rotation > rejects the old token',
        classname: 'tests/probes/rotate.test.ts',
        outcome: 'failed',
        message: 'expected 401, got 200\nAssertionError: expected 401, got 200\n ❯ tests/probes/rotate.test.ts:5:3',
      },
      { name: 'rotation > issues a token', classname: 'tests/probes/rotate.test.ts', outcome: 'passed', message: '' },
    ]);
  });

  it('reads a Jest report, whose failures carry only a body', () => {
    const xml = [
      '<testsuites name="jest tests" tests="1" failures="1">',
      '  <testsuite name="rotate" errors="0" failures="1" skipped="0" tests="1">',
      '    <testcase classname="rotate rejects the old token" name="rotate rejects the old token" time="0.004">',
      '      <failure>Error: expect(received).toBe(expected) // Object.is equality',
      '',
      'Expected: 401',
      'Received: 200</failure>',
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n');
    const [only] = cases(xml);
    expect(only?.outcome).toBe('failed');
    expect(only?.message).toBe('Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 401\nReceived: 200');
  });

  it('reads a pytest report: passed, failed, errored and skipped', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<testsuites><testsuite name="pytest" errors="1" failures="1" skipped="1" tests="4">',
      '<testcase classname="tests.test_rotate" name="test_ok" time="0.001" />',
      '<testcase classname="tests.test_rotate" name="test_old_token" time="0.002"><failure message="assert 200 == 401">def test_old_token():&#10;&gt;       assert 200 == 401</failure></testcase>',
      '<testcase classname="tests.test_rotate" name="test_db"><error message="error during setup">fixture &apos;db&apos; not found</error></testcase>',
      '<testcase classname="tests.test_rotate" name="test_later"><skipped type="pytest.skip" message="later">skip</skipped></testcase>',
      '</testsuite></testsuites>',
    ].join('');
    expect(cases(xml)).toEqual([
      { name: 'test_ok', classname: 'tests.test_rotate', outcome: 'passed', message: '' },
      { name: 'test_old_token', classname: 'tests.test_rotate', outcome: 'failed', message: 'assert 200 == 401\ndef test_old_token():\n>       assert 200 == 401' },
      { name: 'test_db', classname: 'tests.test_rotate', outcome: 'errored', message: "error during setup\nfixture 'db' not found" },
      { name: 'test_later', classname: 'tests.test_rotate', outcome: 'skipped', message: '' },
    ]);
  });

  it('reads cases in nested suites, and a bare testsuite root', () => {
    const xml = '<testsuites><testsuite name="a"><testsuite name="b"><testcase name="deep" classname="b"/></testsuite></testsuite></testsuites>';
    expect(cases(xml).map((c) => c.name)).toEqual(['deep']);
    expect(cases('<testsuite name="x"><testcase name="t"></testcase></testsuite>')).toEqual([{ name: 't', classname: '', outcome: 'passed', message: '' }]);
    expect(cases('<testsuite name="empty"/>')).toEqual([]);
  });
});

describe('what a case says', () => {
  it('keeps CDATA as written: markup inside it is text, entities are not decoded', () => {
    const xml =
      '<testsuite><testcase name="t"><failure message="m"><![CDATA[at Object.<anonymous> (a.js:1:1) where 1 < 2 > 0 &amp; </testcase> x]]></failure></testcase></testsuite>';
    expect(cases(xml)).toEqual([{ name: 't', classname: '', outcome: 'failed', message: 'm\nat Object.<anonymous> (a.js:1:1) where 1 < 2 > 0 &amp; </testcase> x' }]);
  });

  it('decodes entities and drops markup outside CDATA, around it', () => {
    const xml = '<testsuite><testcase name="t"><failure>a &lt;b&gt; <b>bold</b><![CDATA[<raw>]]>&amp; end</failure></testcase></testsuite>';
    expect(cases(xml)[0]?.message).toBe('a <b> bold<raw>& end');
  });

  it('reads attributes in either quote, with > inside a value', () => {
    const xml = "<testsuite><testcase name='a > b' classname=\"c's\"><failure message='x &quot;y&quot;'/></testcase></testsuite>";
    expect(cases(xml)).toEqual([{ name: 'a > b', classname: "c's", outcome: 'failed', message: 'x "y"' }]);
  });

  it('reads a case with no name as unnamed', () => {
    expect(cases('<testsuite><testcase/></testsuite>')).toEqual([{ name: '', classname: '', outcome: 'passed', message: '' }]);
  });

  it('counts a failure over an error, in either order, and either over a skip', () => {
    const outcome = (inner: string): string | undefined => cases(`<testsuite><testcase name="t">${inner}</testcase></testsuite>`)[0]?.outcome;
    expect(outcome('<error/>')).toBe('errored');
    expect(outcome('<failure/>')).toBe('failed');
    expect(outcome('<failure/><error/>')).toBe('failed');
    expect(outcome('<error/><failure/>')).toBe('failed');
    expect(outcome('<skipped/>')).toBe('skipped');
    expect(outcome('<skipped/><failure/>')).toBe('failed');
    expect(outcome('<error/><skipped/>')).toBe('errored');
    expect(outcome('<system-out>failure</system-out>')).toBe('passed');
  });

  it('joins every message and body, and leaves out empty ones', () => {
    const xml = '<testsuite><testcase name="t"><failure message="">  </failure><error message="first">second</error><failure message="third"/></testcase></testsuite>';
    expect(cases(xml)[0]?.message).toBe('first\nsecond\nthird');
  });

  it('never reads a case out of a comment or a declaration', () => {
    const xml = '<!DOCTYPE x><?pi <testcase name="pi"/> ?><testsuite><!-- <testcase name="ghost"/> --><testcase name="real"/></testsuite>';
    expect(cases(xml).map((c) => c.name)).toEqual(['real']);
  });
});

describe('the tokenizer\'s edges', () => {
  it('reads an attribute with space around its equals sign', () => {
    expect(cases('<testsuite><testcase name = "spaced" classname=\'c\'/></testsuite>')).toEqual([{ name: 'spaced', classname: 'c', outcome: 'passed', message: '' }]);
  });

  it('reads a report whose root is testsuites with no suite inside', () => {
    expect(cases('<testsuites name="empty"/>')).toEqual([]);
  });

  it('ends a comment at the first --> after its opening, never inside it', () => {
    // "<!-->" does not close itself: the comment runs to the next "-->".
    expect(cases('<testsuite><!--><testcase name="ghost"/>--><testcase name="real"/></testsuite>').map((c) => c.name)).toEqual(['real']);
    expect(cases('<testsuite><!--<1--><testcase name="t"/></testsuite>').map((c) => c.name)).toEqual(['t']);
  });

  it('skips a declaration and a CDATA section whole, whatever they end with', () => {
    expect(cases('<!<><testsuite><testcase name="t"/></testsuite>').map((c) => c.name)).toEqual(['t']);
    expect(cases('<testsuite><testcase name="t"><failure><![CDATA[a<1]]></failure></testcase></testsuite>')[0]?.message).toBe('a<1');
    expect(cases('<testsuite><testcase name="t"><failure>]]><![CDATA[x]]></failure></testcase></testsuite>')[0]?.message).toBe(']]>x');
  });

  it('continues after a tag at its closing bracket', () => {
    expect(cases('<testsuite><testcase name="t" x=<></testcase></testsuite>')).toEqual([{ name: 't', classname: '', outcome: 'passed', message: '' }]);
  });

  it('ignores a closing tag with no case open', () => {
    expect(cases('<testsuite></testcase><testcase name="t"/></testsuite>').map((c) => c.name)).toEqual(['t']);
  });

  it('keeps each case\'s failure body its own', () => {
    const xml = [
      '<testsuite>',
      '<testcase name="a"><failure>body a</failure></testcase>',
      '<testcase name="b"><failure message="only b"/></testcase>',
      '<testcase name="c"><failure>body c</failure></testcase>',
      '</testsuite>',
    ].join('');
    expect(cases(xml).map((c) => [c.name, c.message])).toEqual([
      ['a', 'body a'],
      ['b', 'only b'],
      ['c', 'body c'],
    ]);
  });

  it('reads a failure never closed inside a closed case as a failure with no body', () => {
    expect(cases('<testsuite><testcase name="t"><failure>lost</testcase></testsuite>')).toEqual([{ name: 't', classname: '', outcome: 'failed', message: '' }]);
  });
});

describe('what cannot be read', () => {
  it('refuses a report with no suite, rather than reading it as all green', () => {
    expect(refusal('')).toBe('no <testsuite> element: this is not a JUnit report');
    expect(refusal('<results><testcase name="t"/></results>')).toBe('no <testsuite> element: this is not a JUnit report');
    expect(refusal('just text')).toBe('no <testsuite> element: this is not a JUnit report');
  });

  it('refuses a document that stops in the middle of something', () => {
    expect(refusal('<testsuite><!-- open')).toBe('a comment is never closed');
    expect(refusal('<testsuite><![CDATA[ open')).toBe('a CDATA section is never closed');
    expect(refusal('<testsuite><!DOCTYPE')).toBe('a declaration is never closed');
    expect(refusal('<testsuite><testcase name="t')).toBe('a tag is never closed');
    // Twenty characters of what follows the "<" are enough to find it by.
    expect(refusal('<testsuite name="x">1 <2 and more</testsuite>')).toBe('"<2 and more</testsuit" is not a tag');
    expect(refusal('<testsuite><testcase name="t"><failure/></testsuite>')).toBe('test case "t" is never closed');
  });
});

describe('entities', () => {
  it('decodes the five named entities and numeric references', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
    expect(decodeEntities('&#65;&#x42;&#X43;&#x1F600;')).toBe('AB&#X43;\u{1F600}');
  });

  it('leaves an unknown or impossible entity as written', () => {
    expect(decodeEntities('&nbsp; &#x110000; &#1114112; & amp; &amp')).toBe('&nbsp; &#x110000; &#1114112; & amp; &amp');
    expect(decodeEntities('&#1114111;')).toBe('\u{10FFFF}');
    expect(decodeEntities('&#x10FFFF;&#x10ffff;')).toBe('\u{10FFFF}\u{10FFFF}');
  });
});
