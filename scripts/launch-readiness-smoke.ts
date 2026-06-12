#!/usr/bin/env ts-node

const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath: string) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFileContains(relativePath: string, expected: string) {
  const content = read(relativePath);
  assert(content.includes(expected), `${relativePath} should contain: ${expected}`);
}

function main() {
  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts?.lint && !packageJson.scripts.lint.includes('next lint'), 'lint script must not use next lint');

  [
    'app/terms/page.tsx',
    'app/privacy/page.tsx',
    'app/contact/page.tsx',
    'app/(auth)/forgot-password/page.tsx',
  ].forEach((relativePath) => assert(exists(relativePath), `${relativePath} is missing`));

  assert(!exists('components/modules/drills-module-v2.tsx'), 'unused drills-module-v2.tsx should not exist');

  const mainModules = [
    'components/modules/drills-module.tsx',
    'components/modules/homework-module.tsx',
    'components/modules/exams-module.tsx',
    'components/modules/labs-module.tsx',
    'components/modules/exam-evaluation-module.tsx',
    'components/modules/lecture-rehearsal-module.tsx',
  ];
  for (const relativePath of mainModules) {
    const content = read(relativePath);
    assert(!content.includes('Please configure your API key'), `${relativePath} still asks teachers to configure API keys`);
    assert(!content.includes('Debug: Allow Fallback'), `${relativePath} still exposes Debug: Allow Fallback`);
  }

  assertFileContains('components/modules/drills-module.tsx', 'includeWebResources: includeWebResources || false');
  assertFileContains('components/modules/exam-evaluation-module.tsx', "action: 'parse_teacher'");
  assertFileContains('components/modules/exam-evaluation-module.tsx', 'teacherPaper?.confirmed');
  assertFileContains('app/api/evaluate-exam/route.ts', "action?: 'parse_teacher' | 'evaluate'");
  assertFileContains('app/api/evaluate-exam/route.ts', 'Teacher question set must be reviewed and confirmed before evaluation');
  assertFileContains('app/api/extract-archive/route.ts', 'studentGroups');
  assertFileContains('app/api/extract-archive/route.ts', 'limits');

  [
    'app/api/parse-file/route.ts',
    'app/api/extract-archive/route.ts',
    'app/api/detect-subject/route.ts',
    'app/api/refine-outline/route.ts',
    'app/api/proxy-llm/route.ts',
    'app/api/evaluate-exam/route.ts',
  ].forEach((relativePath) => assertFileContains(relativePath, 'requireUserSession'));

  assertFileContains('app/api/admin/llm-models/route.ts', 'requireAdminSession');
  assertFileContains('lib/llm/platform.ts', 'PLATFORM_LLM_API_KEY');

  console.log('Launch readiness smoke checks passed.');
}

main();
