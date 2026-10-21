import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendDestructiveArgs,
  gatherTestsForDeployment,
  mapApexToTests,
  mapApexTriggersToTests,
  readTestMap,
  resolveDestructiveChanges
} from '../src/commands/metadelta/findtest.js';

const writeFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-findtest-'));
  const classes = path.join(root, 'classes');
  const triggers = path.join(root, 'triggers');
  fs.mkdirSync(classes);
  fs.mkdirSync(triggers);

  fs.writeFileSync(path.join(classes, 'KIO_QuoteService.cls'), `public class KIO_QuoteService {
  public static void execute() { }
}`);
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

test('findtest ignores interfaces and enum-only classes and resolves indirect coverage', () => {
  const fixture = writeFixture();
  try {
    fs.writeFileSync(path.join(fixture.classes, 'IFoo.cls'), `public interface IFoo {
  String nombre();
}`);
    fs.writeFileSync(path.join(fixture.classes, 'ColorEnum.cls'), 'public enum ColorEnum { ROJO, AZUL }');
    fs.writeFileSync(path.join(fixture.classes, 'FooA.cls'), `public class FooA implements IFoo {
  public String nombre() { return 'A'; }
}`);
    fs.writeFileSync(path.join(fixture.classes, 'FooService.cls'), `public class FooService {
  public static List<IFoo> todos() {
    return new List<IFoo>{new FooA()};
  }
}`);
    fs.writeFileSync(path.join(fixture.classes, 'FooServiceTest.cls'), `@IsTest
private class FooServiceTest {
  @IsTest static void covers() { FooService.todos(); }
}`);
    fs.writeFileSync(path.join(fixture.classes, 'BarCast.cls'), `public class BarCast implements IFoo {
  public String nombre() { return 'B'; }
}`);
    fs.writeFileSync(path.join(fixture.classes, 'BarCastSpec.cls'), `@IsTest
private class BarCastSpec {
  @IsTest static void covers() { IFoo value = new BarCast(); }
}`);

    const result = mapApexToTests(fixture.classes);
    assert.equal(result.mapping.IFoo.confidence, 'no_requiere');
    assert.equal(result.mapping.ColorEnum.confidence, 'no_requiere');
    assert.equal(result.mapping.FooA.confidence, 'indirecta');
    assert.equal(result.mapping.FooA.via, 'FooService');
    assert.equal(result.mapping.FooA.testClass, 'FooServiceTest');
    assert.equal(result.mapping.BarCast.confidence, 'reference');

    const gathered = gatherTestsForDeployment(
      ['IFoo', 'ColorEnum', 'FooA', 'FooService', 'BarCast'],
      ['IFoo', 'ColorEnum', 'FooA', 'FooService', 'BarCast', 'FooServiceTest', 'BarCastSpec'],
      result.mapping,
      fixture.classes,
      new Set(Object.keys(result.mapping))
    );
    assert.deepEqual(gathered.apexWithoutTests, []);
    assert.deepEqual(new Set(gathered.testsToRun), new Set(['FooServiceTest', 'BarCastSpec']));
    assert.equal(gathered.nonCoverageClasses.get('IFoo'), 'interface');
    assert.equal(gathered.nonCoverageClasses.get('ColorEnum'), 'enum');
  } finally {
    fs.rmSync(fixture.root, {recursive: true, force: true});
  }
});

test('findtest gives an explicit test map priority and supports JSON/CSV files', () => {
  const fixture = writeFixture();
  const jsonPath = path.join(fixture.root, 'findtest-map.json');
  const csvPath = path.join(fixture.root, 'findtest-map.csv');
  try {
    fs.writeFileSync(jsonPath, JSON.stringify({KIO_QuoteService: ['KIO_QuoteSpec']}));
    fs.writeFileSync(csvPath, 'class,test\nKIO_QuoteService,KIO_QuoteSpec;KIO_QuoteServiceTest\n');
    const jsonMap = readTestMap(jsonPath);
    const csvMap = readTestMap(csvPath);
    assert.deepEqual(jsonMap.get('KIO_QuoteService'), ['KIO_QuoteSpec']);
    assert.deepEqual(csvMap.get('KIO_QuoteService'), ['KIO_QuoteSpec', 'KIO_QuoteServiceTest']);

    const result = mapApexToTests(fixture.classes, {testMap: jsonMap});
    assert.equal(result.mapping.KIO_QuoteService.confidence, 'mapa');
    assert.deepEqual(result.mapping.KIO_QuoteService.testClasses, ['KIO_QuoteSpec']);
  } finally {
    fs.rmSync(fixture.root, {recursive: true, force: true});
  }
});

test('findtest discovers the finddelta destructive manifest and defaults it to POST', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-findtest-destructive-'));
  const manifestDir = path.join(root, 'manifest');
  fs.mkdirSync(manifestDir);
  fs.writeFileSync(path.join(manifestDir, 'release.xml'), '<Package><version>66.0</version></Package>');
  const destructivePath = path.join(manifestDir, 'Destructive-release.xml');
  fs.writeFileSync(destructivePath, `<Package>
  <types><members>ObsoleteClass</members><name>ApexClass</name></types>
  <version>66.0</version>
</Package>`);

  try {
    assert.deepEqual(resolveDestructiveChanges(path.join(manifestDir, 'release.xml'), root), [{
      path: destructivePath,
      order: 'post',
      memberCount: 1
    }]);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('findtest honors explicit pre/post destructive paths and appends both flags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metadelta-findtest-order-'));
  const manifestDir = path.join(root, 'manifest');
  const preDir = path.join(manifestDir, 'preDestructive');
  const postDir = path.join(manifestDir, 'postDestructive');
  fs.mkdirSync(preDir, {recursive: true});
  fs.mkdirSync(postDir, {recursive: true});
  const manifestPath = path.join(manifestDir, 'release.xml');
  fs.writeFileSync(manifestPath, '<Package><version>66.0</version></Package>');
  const prePath = path.join(preDir, 'destructiveChanges.xml');
  const postPath = path.join(postDir, 'destructiveChanges.xml');
  const destructiveXml = '<Package><types><members>Obsolete</members><name>ApexClass</name></types><version>66.0</version></Package>';
  fs.writeFileSync(prePath, destructiveXml);
  fs.writeFileSync(postPath, destructiveXml);

  try {
    const changes = resolveDestructiveChanges(manifestPath, root);
    const args = appendDestructiveArgs(['project', 'deploy', 'start'], changes);
    assert.deepEqual(changes.map((change) => change.order), ['pre', 'post']);
    assert.ok(args.includes('--pre-destructive-changes'));
    assert.ok(args.includes('--post-destructive-changes'));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
