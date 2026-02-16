import { categorizeMarket } from '../categorize';

describe('categorizeMarket', () => {
  // Sports
  test('detects hockey game question as sports', () => {
    expect(categorizeMarket('Will Cornell Hockey beat Harvard on Feb 22?')).toBe('sports');
  });

  test('detects basketball question as sports', () => {
    expect(categorizeMarket('Will Cornell Basketball win the Ivy League title?')).toBe('sports');
  });

  test('detects ECAC as sports', () => {
    expect(categorizeMarket('Will Cornell finish top 4 in ECAC?')).toBe('sports');
  });

  test('detects olympic medal question as sports', () => {
    expect(categorizeMarket('Will a Cornell athlete win a medal at the 2026 Olympics?')).toBe('sports');
  });

  // Campus
  test('detects Slope Day question as campus', () => {
    expect(categorizeMarket('Will Slope Day 2026 announce a headliner before April 1st?')).toBe('campus');
  });

  test('detects flooding as campus', () => {
    expect(categorizeMarket('Will there be another flooding incident in a campus building?')).toBe('campus');
  });

  test('detects dining hall as campus', () => {
    expect(categorizeMarket('Will RPCC get a new food station this semester?')).toBe('campus');
  });

  // Academic
  test('detects prelim question as academic', () => {
    expect(categorizeMarket('Will CS 2110 have a median above 80 on prelim 1?')).toBe('academic');
  });

  test('detects professor question as academic', () => {
    expect(categorizeMarket('Will Prof. Smith curve the final exam?')).toBe('academic');
  });

  // Admin
  test('detects code of conduct question as admin', () => {
    expect(categorizeMarket('Will Cornell\'s revised Code of Conduct take effect before Fall 2026?')).toBe('admin');
  });

  test('detects protest/policy question as admin', () => {
    expect(categorizeMarket('Will Cornell sever ties with ICE by end of Spring semester?')).toBe('admin');
  });

  test('detects student assembly vote as admin', () => {
    expect(categorizeMarket('Will the Student Assembly vote to pass the new resolution?')).toBe('admin');
  });

  // Wildcard fallback
  test('falls back to wildcard for unrecognized question', () => {
    expect(categorizeMarket('Will the moon look extra bright tonight?')).toBe('wildcard');
  });

  test('returns wildcard for empty string', () => {
    expect(categorizeMarket('')).toBe('wildcard');
  });

  test('returns wildcard for null input', () => {
    expect(categorizeMarket(null)).toBe('wildcard');
  });
});
