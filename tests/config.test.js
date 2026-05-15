const fs = require('fs');

// Bypass the global fs.readFileSync intercept for these tests by using the
// original (already saved in setup.js as 'original'). We control the file
// content ourselves per test via jest.spyOn.
const { loadEnv } = require('../src/config');

beforeEach(() => {
  jest.spyOn(fs, 'readFileSync');
});

function setEnvFile(content) {
  fs.readFileSync.mockImplementation((filePath, encoding) => {
    if (String(filePath).endsWith('.env')) return content;
    return jest.requireActual('fs').readFileSync(filePath, encoding);
  });
}

describe('loadEnv', () => {
  test('sets basic KEY=value pairs', () => {
    setEnvFile('FOO=bar\nBAZ=qux');
    loadEnv();
    expect(process.env.FOO).toBe('bar');
    expect(process.env.BAZ).toBe('qux');
  });

  test('strips surrounding double quotes', () => {
    setEnvFile('QUOTED="hello world"');
    loadEnv();
    expect(process.env.QUOTED).toBe('hello world');
  });

  test('strips surrounding single quotes', () => {
    setEnvFile("SINGLE='hello world'");
    loadEnv();
    expect(process.env.SINGLE).toBe('hello world');
  });

  test('strips inline comments preceded by whitespace', () => {
    setEnvFile('WITH_COMMENT=myvalue # this is a comment');
    loadEnv();
    expect(process.env.WITH_COMMENT).toBe('myvalue');
  });

  test('preserves # that is part of the value with no preceding space', () => {
    setEnvFile('HEX_COLOR=#ff0000');
    loadEnv();
    expect(process.env.HEX_COLOR).toBe('#ff0000');
  });

  test('skips comment lines', () => {
    delete process.env.SHOULD_NOT_EXIST;
    setEnvFile('# SHOULD_NOT_EXIST=yes');
    loadEnv();
    expect(process.env.SHOULD_NOT_EXIST).toBeUndefined();
  });

  test('skips blank lines without throwing', () => {
    setEnvFile('\n\nFOO=bar\n\n');
    loadEnv();
    expect(process.env.FOO).toBe('bar');
  });

  test('handles export prefix', () => {
    setEnvFile('export EXPORTED=yes');
    loadEnv();
    expect(process.env.EXPORTED).toBe('yes');
  });

  test('handles values containing = signs', () => {
    setEnvFile('BASE64=abc=def==');
    loadEnv();
    expect(process.env.BASE64).toBe('abc=def==');
  });

  test('does not throw when .env is missing', () => {
    fs.readFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    expect(() => loadEnv()).not.toThrow();
  });
});
