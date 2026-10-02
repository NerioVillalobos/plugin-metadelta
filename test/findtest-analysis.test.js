import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gatherTestsForDeployment,
  mapApexToTests,
  mapApexTriggersToTests
} from '../src/commands/metadelta/findtest.js';

const writeFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-findtest-'));
  const classes = path.join(root, 'classes');
  const triggers = path.join(root, 'triggers');
  fs.mkdirSync(classes);
  fs.mkdirSync(triggers);

  fs.writeFileSync(path.join(classes, 'KIO_QuoteService.cls'), 'public class KIO_QuoteService {}');
  fs.writeFileSync(path.join(classes, 'KIO_QuoteServiceTest.cls'), `@IsTest
private class KIO_QuoteServiceTest {
  @IsTest static void covers() {
    KIO_QuoteService service = new KIO_QuoteService();
  }
}`);
  fs.writeFileSync(path.join(classes, 'KIO_QuoteSpec.cls'), `@IsTest
private class KIO_QuoteSpec {
  @IsTest static void covers() {
    KIO_QuoteService service = new KIO_QuoteService();
  }
}`);
  fs.writeFileSync(path.join(classes, 'KIO_TestDataFactory.cls'), `@IsTest
private class KIO_TestDataFactory {
  public static Account makeAccount() { return new Account(Name = 'fixture'); }
}`);
  fs.writeFileSync(path.join(classes, 'KIO_PEPHandlerTest.cls'), `@IsTest
private class KIO_PEPHandlerTest {
  @IsTest static void covers() {
    insert new KIO_PEP__c(Name = 'fixture');
  }
}`);
  fs.writeFileSync(path.join(triggers, 'KIO_PEPTrigger.trigger'), `trigger KIO_PEPTrigger on KIO_PEP__c (after insert) {
  new KIO_PEPHandler().handle(Trigger.new);
}`);

  return {root, classes, triggers};
};

test('findtest classifies @IsTest classes by source and excludes factories without test methods', () => {
  const fixture = writeFixture();
  try {
    const mapping = mapApexToTests(fixture.classes);
    assert.ok(mapping.mapping.KIO_QuoteService);
    assert.equal(mapping.mapping.KIO_QuoteService.confidence, 'exact');
    assert.ok(mapping.mapping.KIO_QuoteService.testClasses.includes('KIO_QuoteSpec'));
    assert.equal(mapping.mapping.KIO_TestDataFactory, undefined);
  } finally {
    fs.rmSync(fixture.root, {recursive: true, force: true});
  }
});

test('findtest uses manifest tests and trigger DML coverage in RunSpecifiedTests', () => {
  const fixture = writeFixture();
  try {
    const classMapping = mapApexToTests(fixture.classes);
    const triggerMapping = mapApexTriggersToTests(fixture.triggers, fixture.classes);
    const result = gatherTestsForDeployment(
      ['KIO_QuoteService'],
      ['KIO_QuoteService', 'KIO_QuoteServiceTest', 'KIO_TestDataFactory'],
      classMapping.mapping,
      fixture.classes,
      new Set(['KIO_QuoteService']),
      ['KIO_PEPTrigger'],
      triggerMapping,
      fixture.triggers
    );

    assert.deepEqual(new Set(result.testsToRun), new Set([
      'KIO_QuoteServiceTest',
      'KIO_QuoteSpec',
      'KIO_PEPHandlerTest'
    ]));
    assert.deepEqual(result.triggerWithoutTests, []);
    assert.deepEqual(result.apexWithoutTests, []);
    assert.deepEqual(result.missingTestFiles, []);
  } finally {
    fs.rmSync(fixture.root, {recursive: true, force: true});
  }
});
