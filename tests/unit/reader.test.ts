import { describe, expect, it } from 'vitest';

import { createReader, sameSection } from '../../src/reader.js';

const reader = createReader();

describe('fenced blocks', () => {
  it('reads each block\'s info string, content and opening line', () => {
    const text = ['# B', '', '```probe', 'id: a', 'run: x', '```', '', '~~~ probe-file tests/a.ts', 'line 1', '', 'line 3', '~~~'].join('\n');
    expect(reader.codeBlocks(text)).toEqual([
      { info: 'probe', content: 'id: a\nrun: x', line: 3 },
      { info: 'probe-file tests/a.ts', content: 'line 1\n\nline 3', line: 8 },
    ]);
  });

  it('reads an empty block as empty, and an unclosed one to the end of the document', () => {
    expect(reader.codeBlocks('```probe\n```\n')).toEqual([{ info: 'probe', content: '', line: 1 }]);
    expect(reader.codeBlocks('text\n\n```probe\nid: a\nrun: x')).toEqual([{ info: 'probe', content: 'id: a\nrun: x', line: 3 }]);
  });

  it('reads no block out of another block, an indented block or a comment', () => {
    const text = ['````markdown', '```probe', 'id: fake', '```', '````', '', '    ```probe', '    id: indented', '', '<!--', '```probe', 'id: hidden', '```', '-->'].join('\n');
    expect(reader.codeBlocks(text)).toEqual([{ info: 'markdown', content: '```probe\nid: fake\n```', line: 1 }]);
  });

  it('reads a block in a list item or a block quote as its code, without the indent or the markers', () => {
    const text = ['1. Add the probe:', '', '   ```probe-file tests/p.py', '   def test():', '       assert False', '   ```', '', '> ```probe', '> id: quoted', '> ```'].join('\n');
    expect(reader.codeBlocks(text)).toEqual([
      { info: 'probe-file tests/p.py', content: 'def test():\n    assert False', line: 3 },
      { info: 'probe', content: 'id: quoted', line: 8 },
    ]);
  });

  it('keeps a line indented less than its fence as far as it goes, and keeps CRLF out of the content', () => {
    expect(reader.codeBlocks('  ```probe\r\n x\r\ny\r\n    z\r\n  ```\r\n')).toEqual([{ info: 'probe', content: 'x\ny\n  z', line: 1 }]);
  });
});

describe('sections', () => {
  const text = ['---', 'status: active', '---', '', '# 012 - Title', '', 'Under the title.', '', '## Intent', '', 'x', '', '### Detail', '', 'y', '', '## Invariants', '', 'z'].join('\n');

  it('names the section a line sits in: the nearest heading of level two or more above it', () => {
    expect(reader.sectionAt(text, 7)).toBeNull();
    expect(reader.sectionAt(text, 9)).toBe('Intent');
    expect(reader.sectionAt(text, 11)).toBe('Intent');
    expect(reader.sectionAt(text, 15)).toBe('Detail');
    expect(reader.sectionAt(text, 19)).toBe('Invariants');
    expect(reader.sectionAt(text, 1)).toBeNull();
    expect(reader.sectionAt(text, 0)).toBeNull();
  });

  it('names every section a line sits in, outermost first', () => {
    expect(reader.sectionsAt(text, 15)).toEqual(['Intent', 'Detail']);
    expect(reader.sectionsAt(text, 11)).toEqual(['Intent']);
    // A heading at the level of an open one closes it, and a deeper one does not.
    expect(reader.sectionsAt(text, 19)).toEqual(['Invariants']);
    expect(reader.sectionsAt(text, 7)).toEqual([]);
    expect(reader.sectionsAt(['## A', '', '#### Deep', '', '### Mid', '', 'x', ''].join('\n'), 7)).toEqual(['A', 'Mid']);
  });

  it('never takes a heading shown in code for a section', () => {
    expect(reader.sectionAt('## Real\n\n```\n## Fake\n```\n\nx\n', 7)).toBe('Real');
  });

  it('compares section names without case, emphasis, a leading number or a trailing colon', () => {
    expect(sameSection('Rulings', 'rulings')).toBe(true);
    expect(sameSection('**Rulings**', 'Rulings')).toBe(true);
    expect(sameSection('3. Rulings:', 'Rulings')).toBe(true);
    expect(sameSection('2) `Rulings` :', 'rulings')).toBe(true);
    expect(sameSection('_Rulings_', 'Rulings')).toBe(true);
    expect(sameSection('Rulings', '1. Rulings')).toBe(true);
  });

  it('takes off a number of any length, before any spacing, with or without its point', () => {
    expect(sameSection('12. Rulings', 'Rulings')).toBe(true);
    expect(sameSection('1 Rulings', 'Rulings')).toBe(true);
    expect(sameSection('  3.   Rulings', 'Rulings')).toBe(true);
    expect(sameSection('  Rulings', 'Rulings')).toBe(true);
    expect(sameSection('Rulings ::', 'Rulings')).toBe(true);
  });

  it('takes a number off the front only, and only a number', () => {
    expect(sameSection('Rulings 2 ', 'Rulings')).toBe(false);
    expect(sameSection('x3 Rulings', 'Rulings')).toBe(false);
  });

  it('does not match a different name that shares words', () => {
    expect(sameSection('Rulings table', 'Rulings')).toBe(false);
    expect(sameSection('Rulings', 'Ruling')).toBe(false);
    expect(sameSection('3.Rulings', 'Rulings')).toBe(false);
    expect(sameSection('Rul ings', 'Rulings')).toBe(false);
  });
});

describe('a section\'s tables', () => {
  const text = [
    '# 012', // 1
    '', // 2
    '## Rulings', // 3
    '', // 4
    '| Ruling | Paths | Decision | Note |', // 5
    '| --- | --- | --- | --- |', // 6
    '| R-012-1 | `src/a.ts` | allow | ok \\| fine |', // 7
    '| R-012-2 | `src/b.ts` | deny | no |', // 8
    '', // 9
    '### Older', // 10
    '', // 11
    '| Ruling | Paths | Decision |', // 12
    '| --- | --- | --- |', // 13
    '| R-012-0 | `c` | allow |', // 14
    '', // 15
    '## Report', // 16
    '', // 17
    '| Not | Here |', // 18
    '| --- | --- |', // 19
  ].join('\n');

  it('reads every table in the section and its subsections, with each row\'s line', () => {
    expect(reader.sectionTables(text, 'rulings')).toEqual({
      tables: [
        {
          headers: ['Ruling', 'Paths', 'Decision', 'Note'],
          rows: [
            { cells: ['R-012-1', '`src/a.ts`', 'allow', 'ok \\| fine'], line: 7 },
            { cells: ['R-012-2', '`src/b.ts`', 'deny', 'no'], line: 8 },
          ],
        },
        { headers: ['Ruling', 'Paths', 'Decision'], rows: [{ cells: ['R-012-0', '`c`', 'allow'], line: 14 }] },
      ],
      headingLine: 3,
      tableEndLine: 14,
    });
  });

  it('says where the heading ends and the last table ends, as addRulingRow inserts at them', () => {
    const lines = text.split('\n');
    const where = reader.sectionTables(text, 'Rulings');
    // headingLine is the 1-based heading line: the 0-based index just after it.
    expect(lines[(where.headingLine as number) - 1]).toBe('## Rulings');
    // tableEndLine is the 1-based last row: the 0-based index of the line after it.
    expect(lines[(where.tableEndLine as number) - 1]).toBe('| R-012-0 | `c` | allow |');
    expect(lines[where.tableEndLine as number]).toBe('');
  });

  it('reports a section with no table, and a document with no such section', () => {
    expect(reader.sectionTables('# B\n\n## Rulings\n\nNone yet.\n\n## Next\n\n| a | b |\n| - | - |\n', 'Rulings')).toEqual({ tables: [], headingLine: 3, tableEndLine: null });
    expect(reader.sectionTables(text, 'Decisions')).toEqual({ tables: [], headingLine: null, tableEndLine: null });
  });

  it('ends a section at the next heading of its level or above, and reads a section that runs to the end', () => {
    const tail = '# B\n\n## Rulings\n\n| Ruling | Paths | Decision |\n| --- | --- | --- |\n| R-1 | `a` | allow |';
    expect(reader.sectionTables(tail, 'Rulings')).toMatchObject({ headingLine: 3, tableEndLine: 7 });
    expect(reader.sectionTables('# Rulings\n\n| Ruling | Paths | Decision |\n| --- | --- | --- |\n', 'Rulings').headingLine).toBeNull();
  });

  it('ends a setext heading at its underline', () => {
    expect(reader.sectionTables('Rulings\n-------\n\n| Ruling | Paths | Decision |\n| --- | --- | --- |\n', 'Rulings')).toMatchObject({ headingLine: 2, tableEndLine: 5 });
  });

  it('never reads a table from before the section', () => {
    const before = '# B\n\n## Intent\n\n| Ruling | Paths | Decision |\n| --- | --- | --- |\n| R-0 | `x` | allow |\n\n## Rulings\n\nNone.\n';
    expect(reader.sectionTables(before, 'Rulings')).toEqual({ tables: [], headingLine: 9, tableEndLine: null });
  });

  it('never reads a table shown in code', () => {
    expect(reader.sectionTables('## Rulings\n\n```\n| Ruling | Paths | Decision |\n| --- | --- | --- |\n```\n', 'Rulings').tables).toEqual([]);
  });
});

describe('citations', () => {
  it('reads the links a document cites, and not images, autolinks or definitions as links of their own', () => {
    const text = [
      'See [the design](../docs/design.md), [ref][r] and [shortcut].',
      '',
      '![diagram](../docs/diagram.png) and <https://example.com> and [web](https://example.com/x).',
      '',
      '`[in code](not.md)`',
      '',
      '[r]: ../docs/ref.md',
      '[shortcut]: ../docs/short.md',
    ].join('\n');
    expect(reader.citations(text)).toEqual([
      { target: '../docs/design.md', line: 1 },
      { target: '../docs/ref.md', line: 1 },
      { target: '../docs/short.md', line: 1 },
      { target: 'https://example.com/x', line: 3 },
    ]);
  });

  it('reads the link around a badge, and not the image inside its text', () => {
    // spec-core lists the image after the link it lies in; the image is a
    // picture on the page, not a document the brief cites.
    expect(reader.citations('[![b](img/x.png)](../docs/a.md) and [![c][badge]](../docs/c.md)\n\n[badge]: img/y.svg\n')).toEqual([
      { target: '../docs/a.md', line: 1 },
      { target: '../docs/c.md', line: 1 },
    ]);
  });

  it('reads a link inside a link\'s text as the one link, and not the brackets around it', () => {
    // CommonMark lets no link hold another: the inner link is the link, and
    // the outer brackets and destination are text on the page, so the brief
    // cites the inner document only.
    expect(reader.citations('[a [b](inner.md) c](outer.md)\n')).toEqual([{ target: 'inner.md', line: 1 }]);
  });
});

describe('title and status', () => {
  it('reads the first level-one heading and the front matter\'s status', () => {
    expect(reader.titleAndStatus('---\nstatus: accepted\n---\n\n## Not the title\n\n# The Title\n\n# Second\n')).toEqual({ title: 'The Title', status: 'accepted', unclosedFrontMatter: false });
    expect(reader.titleAndStatus('---\nstatus: "superseded"\n---\n\nSetext\n======\n')).toEqual({ title: 'Setext', status: 'superseded', unclosedFrontMatter: false });
  });

  it('reads nothing that is not there, or not a word', () => {
    expect(reader.titleAndStatus('no heading\n')).toEqual({ title: null, status: null, unclosedFrontMatter: false });
    expect(reader.titleAndStatus('---\nstatus:\n---\n# T\n')).toEqual({ title: 'T', status: null, unclosedFrontMatter: false });
    expect(reader.titleAndStatus('---\nstatus: [a, b]\n---\n')).toEqual({ title: null, status: null, unclosedFrontMatter: false });
    expect(reader.titleAndStatus('---\ntitle: x\n---\n')).toEqual({ title: null, status: null, unclosedFrontMatter: false });
    expect(reader.titleAndStatus('```\n# In code\n```\n')).toEqual({ title: null, status: null, unclosedFrontMatter: false });
  });

  it('says when front matter opened on line 1 is never closed, which gives no status, and still reads the title', () => {
    // spec-core reads the opening line as a thematic break and the rest as
    // Markdown, so the author's status is text, and the document would read
    // as one that has none.
    expect(reader.titleAndStatus('---\nstatus: accepted\n\n# ADR-0003: Tokens\n\nRotate them.\n')).toEqual({ title: 'ADR-0003: Tokens', status: null, unclosedFrontMatter: true });
    expect(reader.titleAndStatus('---\nstatus: accepted\n')).toEqual({ title: null, status: null, unclosedFrontMatter: true });
    expect(reader.titleAndStatus('---  \r\nstatus: accepted\r\n\r\n# T\r\n').unclosedFrontMatter).toBe(true);
  });

  it('says nothing of front matter that closes, of none, or of a thematic break after the first line', () => {
    const unclosed = (text: string): boolean => reader.titleAndStatus(text).unclosedFrontMatter;
    expect(unclosed('---\nstatus: accepted\n---\n\n# T\n\nText.\n\n---\n\nMore.\n')).toBe(false);
    expect(unclosed('---\nstatus: accepted\n...\n\n# T\n')).toBe(false);
    expect(unclosed('# T\n\nText.\n\n---\n\nMore.\n')).toBe(false);
    expect(unclosed('\n---\nstatus: accepted\n\n# T\n')).toBe(false);
    expect(unclosed('----\nstatus: accepted\n\n# T\n')).toBe(false);
    expect(unclosed('')).toBe(false);
    // TOML front matter gives no status even when it closes, so closing it
    // would show no status either.
    expect(unclosed('+++\nstatus = "accepted"\n\n# T\n')).toBe(false);
  });
});

describe('one scan, many questions', () => {
  it('answers for the text it is given, never a text it read before', () => {
    const fresh = createReader();
    expect(fresh.sectionAt('## A\n\nx\n', 3)).toBe('A');
    expect(fresh.sectionAt('## A\n\nx\n', 3)).toBe('A');
    expect(fresh.sectionAt('## B\n\nx\n', 3)).toBe('B');
    expect(fresh.titleAndStatus('# One\n').title).toBe('One');
    expect(fresh.titleAndStatus('# Two\n').title).toBe('Two');
  });
});
