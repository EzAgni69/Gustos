const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders || [projectRoot]), monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// React Native 0.79 introduced new package exports resolution that can cause
// Hermes ReferenceErrors and TDZ issues with internal Web Performance APIs.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
