# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in ruah-opt, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email **peter.whzm@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fix (optional)

You will receive an acknowledgment within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Considerations

ruah-opt is a local, read-mostly analytics CLI. Key security areas:

### File System

ruah-opt reads trace files from `.ruah/traces/` (or a directory you pass explicitly) and configuration from `.ruah/opt.json`, both resolved against the current working directory. It never writes outside the consumer's `.ruah/` directory and, in v0.1, does not write at all.

### Input Parsing

Trace files are parsed with `JSON.parse` only — no `eval`, no dynamic imports, no code execution from trace content. Malformed input degrades to warnings.

### No Process Execution

ruah-opt does not spawn child processes.

### No Network Access

ruah-opt makes no network requests. All analysis is local. The built-in price table ships with the package; nothing is fetched.

### No Secrets

ruah-opt never reads, stores, or transmits credentials, API keys, or tokens. Note that trace files you analyze may themselves contain sensitive prompt/output text — treat your `.ruah/traces/` directory accordingly.

### Dependencies

ruah-opt has **zero runtime dependencies**. The attack surface from supply chain compromises is limited to dev dependencies (TypeScript, Biome, @types/node, @ruah-dev/schema) which are not shipped in the published package.
