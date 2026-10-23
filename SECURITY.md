# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

The VoiceForge team takes security vulnerabilities seriously.

If you believe you have discovered a security issue or vulnerability in VoiceForge, please do not report it in a public issue tracker or forum.

Instead, please send an email to the security response team at `security@voiceforge.ai` with:
- A description of the vulnerability.
- Steps to reproduce or proof-of-concept exploit.
- The potential impact and attack vectors.

We will acknowledge receipt within 48 hours and work with you to triage, patch, and coordinate responsible disclosure.

## Security Controls Implemented

- **Helmet**: Enforces secure HTTP headers (X-Content-Type-Options, Referrer-Policy, Frame-Ancestors).
- **CORS**: Explicit origin allowlists.
- **Request Boundaries**: Isolated payload size restrictions on JSON and multipart endpoints.
- **Zero-Downtime Resilience**: Graceful error handling and in-memory persistence fallback.
- **Ethical Biometrics**: Required spoken voice consent to prevent unauthorized impersonation.
