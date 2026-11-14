// Construit l'application web, synchronise Capacitor Android, génère l'APK signé et calcule son SHA-256
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const androidDir = path.join(rootDir, 'android');
const releaseDir = path.join(rootDir, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '0.1.0';

function findLocalJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'))) {
    return process.env.JAVA_HOME;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const candidate = path.join(process.env.LOCALAPPDATA, 'Android', 'jdk-21');
    if (fs.existsSync(path.join(candidate, 'bin', 'java.exe'))) {
      return candidate;
    }
  }
  return undefined;
}

function findLocalAndroidSdk() {
  if (process.env.ANDROID_HOME && fs.existsSync(process.env.ANDROID_HOME)) {
    return process.env.ANDROID_HOME;
  }
  if (process.env.ANDROID_SDK_ROOT && fs.existsSync(process.env.ANDROID_SDK_ROOT)) {
    return process.env.ANDROID_SDK_ROOT;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const candidate = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const env = { ...process.env };
const javaHome = findLocalJavaHome();
if (javaHome) {
  env.JAVA_HOME = javaHome;
  env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${env.PATH ?? ''}`;
}
const androidSdk = findLocalAndroidSdk();
if (androidSdk) {
  env.ANDROID_HOME = androidSdk;
  env.ANDROID_SDK_ROOT = androidSdk;
  // Écrit local.properties (ignoré par Git) pour Gradle si présent localement
  const escapedSdk = androidSdk.replace(/\\/g, '\\\\');
  fs.writeFileSync(path.join(androidDir, 'local.properties'), `sdk.dir=${escapedSdk}\n`, 'utf8');
}

function runOrFail(cmd, args, cwd = rootDir) {
  const res = spawnSync(cmd, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

runOrFail('npm', ['run', 'build']);
runOrFail('npx', ['cap', 'sync', 'android']);

const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
runOrFail(gradleCmd, ['assembleRelease', '--no-daemon'], androidDir);

const apkOutDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release');
const apkFiles = fs.existsSync(apkOutDir)
  ? fs.readdirSync(apkOutDir).filter((f) => f.toLowerCase().endsWith('.apk'))
  : [];

if (apkFiles.length === 0) {
  console.error('Aucun APK généré dans', apkOutDir);
  process.exit(1);
}

const signedApk = apkFiles.find((f) => !f.includes('unsigned')) ?? apkFiles[0];
const srcApkPath = path.join(apkOutDir, signedApk);
const stat = fs.statSync(srcApkPath);
if (stat.size <= 0) {
  console.error('APK généré vide (0 octet).');
  process.exit(1);
}

fs.mkdirSync(releaseDir, { recursive: true });
const targetApkName = `Basic-PDF-${version}-android.apk`;
const targetApkPath = path.join(releaseDir, targetApkName);
fs.copyFileSync(srcApkPath, targetApkPath);
console.log(`APK prêt (${stat.size} octets) : ${targetApkPath}`);

runOrFail('node', ['scripts/write-sha256.mjs']);
