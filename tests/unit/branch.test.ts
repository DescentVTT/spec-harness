import { describe, expect, it } from 'vitest';

import { briefIdFromBranch, idFromBranch, sameId, templateError } from '../../src/branch.js';

describe('templates', () => {
  it('accepts a template with {id} once, at its end', () => {
    expect(templateError('brief/{id}')).toBeNull();
    expect(templateError('*/brief-{id}')).toBeNull();
  });

  it('refuses a template without {id}, with it twice, or with anything after it', () => {
    expect(templateError('brief/')).toBe('"brief/" must contain {id} exactly once');
    expect(templateError('{id}/{id}')).toBe('"{id}/{id}" must contain {id} exactly once');
    expect(templateError('brief/{id}-x')).toBe('"brief/{id}-x" must end with {id}; whatever follows the id is the branch\'s own');
  });

  it('reads nothing through a template it refuses', () => {
    expect(idFromBranch('brief/{id}-x', 'brief/012-x')).toBeNull();
    expect(idFromBranch('brief/', 'brief/012')).toBeNull();
  });
});

describe('the id a branch carries', () => {
  it.each([
    ['brief/{id}', 'brief/012', '012'],
    ['brief/{id}', 'brief/012-rotate-tokens', '012'],
    ['brief/{id}', 'brief/012_rotate', '012'],
    ['brief/{id}', 'brief/012.rotate', '012'],
    ['brief/{id}', 'brief/012/rotate', '012'],
    ['brief/{id}', 'brief/012x', '012x'],
    ['brief/{id}', 'brief/AB12-x', 'AB12'],
    ['brief-{id}', 'brief-7', '7'],
    ['*/brief/{id}', 'nh/brief/012-x', '012'],
    ['*/brief-{id}', 'feature/brief-9_y', '9'],
  ])('%s reads %s as %s', (template, name, id) => {
    expect(idFromBranch(template, name)).toBe(id);
  });

  it.each([
    // A character that is neither part of an id nor a separator ends no id.
    ['brief/{id}', 'brief/012+x'],
    ['brief/{id}', 'brief/'],
    ['brief/{id}', 'brief/-x'],
    // Templates are anchored at the start of the name.
    ['brief/{id}', 'feature/brief/012'],
    ['brief/{id}', 'xbrief/012'],
    // A star never crosses a slash.
    ['*/brief-{id}', 'a/b/brief-7'],
    ['*/brief-{id}', 'brief-7'],
    ['brief-{id}', 'main'],
  ])('%s reads no id from %s', (template, name) => {
    expect(idFromBranch(template, name)).toBeNull();
  });

  it('lets a star match nothing', () => {
    expect(idFromBranch('x*y/{id}', 'xy/5')).toBe('5');
    // A star continues what came before it; it cannot start where that failed.
    expect(idFromBranch('x*/{id}', 'ab/5')).toBeNull();
    expect(idFromBranch('*/brief-{id}', '/brief-7')).toBe('7');
  });

  it('takes the leftmost reading that ends at a separator, skipping one that does not', () => {
    expect(idFromBranch('*-{id}', 'x-12-y')).toBe('12');
    expect(idFromBranch('*-{id}', 'a-b+c-d')).toBe('d');
  });

  it('stops a star at the first slash but lets it end there', () => {
    expect(idFromBranch('*/{id}', 'team/42')).toBe('42');
    expect(idFromBranch('*{id}', 'team/42')).toBe('team');
  });

  it('never goes exponential: many stars against a long name finish at once', () => {
    // A backtracking matcher tries every split of the name among the stars;
    // the table here costs stars times characters.
    const template = `${'*a'.repeat(25)}/{id}`;
    const long = 'a'.repeat(3000);
    const started = performance.now();
    expect(idFromBranch(template, long)).toBeNull();
    expect(idFromBranch(template, `${long}/42`)).toBe('42');
    expect(idFromBranch(template, `${long}b/42`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('asks the templates in order and answers the first that reads an id', () => {
    const templates = ['brief/{id}', '*/brief/{id}'];
    expect(briefIdFromBranch(templates, 'brief/3-x')).toBe('3');
    expect(briefIdFromBranch(templates, 'nh/brief/4-x')).toBe('4');
    expect(briefIdFromBranch(['*-{id}', 'brief-{id}'], 'brief-5')).toBe('5');
    expect(briefIdFromBranch(['brief-{id}', '*-{id}'], 'x-brief-5')).toBe('brief');
    expect(briefIdFromBranch(templates, 'main')).toBeNull();
    expect(briefIdFromBranch([], 'brief/3')).toBeNull();
  });
});

describe('id equality', () => {
  it('matches ids as written, or as numbers when both are all digits', () => {
    expect(sameId('012', '012')).toBe(true);
    expect(sameId('12', '012')).toBe(true);
    expect(sameId('0', '000')).toBe(true);
    expect(sameId('abc', 'abc')).toBe(true);
    // Beyond the safe integers, as numbers still.
    expect(sameId('90071992547409930', '090071992547409930')).toBe(true);
  });

  it('does not match ids that differ, or that are only numeric on one side', () => {
    expect(sameId('12', '13')).toBe(false);
    expect(sameId('12', '12a')).toBe(false);
    expect(sameId('012a', '12a')).toBe(false);
    // Digits must be the whole id on both sides, or BigInt would be asked to read "12a".
    expect(sameId('12a', '12')).toBe(false);
    expect(sameId('a12', '12')).toBe(false);
    expect(sameId('12', 'a12')).toBe(false);
    expect(sameId('abc', 'ABC')).toBe(false);
    expect(sameId('', '0')).toBe(false);
    expect(sameId('90071992547409930', '90071992547409931')).toBe(false);
  });
});
