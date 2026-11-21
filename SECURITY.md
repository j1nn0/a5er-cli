# Security Policy

a5er-cli is a read-only command-line tool for A5:SQL Mk-2 ER diagram (`.a5er`) files. This page
covers how to report a security problem privately, what this project treats as security-relevant,
and how a fix and its publication are coordinated.

a5er-cli is an independent, unofficial project (see the disclaimer in `README.md`). Vulnerabilities
in A5:SQL Mk-2 itself are outside this policy; report those to its author.

## Supported Versions

Security fixes go into the latest stable release published on the npm registry as
`@j1nn0/a5er-cli` — the version the `latest` dist-tag resolves to when you report. At the time of
writing that is `0.1.2`.

| Version                                                                       | Security fixes                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Latest stable release published on npm (`latest` dist-tag), currently `0.1.x` | Supported                                                  |
| Any earlier release                                                           | Not supported — upgrade to the latest stable release first |

This project is pre-1.0 and maintains no long-term support line. Nothing here promises that a fix
is backported to an earlier release, that a superseded minor version stays patched, or that a fix
ships by any particular date. A report against an earlier release may be answered with "upgrade to
the latest stable release"; if the problem still reproduces there, it is in scope.

The npm `latest` dist-tag and this repository's release tags state which versions exist; the table
above describes the current published state and nothing more.

## Reporting a Vulnerability

Report privately through GitHub's private vulnerability reporting. Do not open a public issue, pull
request, discussion or comment, and do not post details elsewhere before disclosure is agreed.

1. Open the repository's Security tab: <https://github.com/j1nn0/a5er-cli/security>
2. Choose **Report a vulnerability**, which starts a private security advisory draft:
   <https://github.com/j1nn0/a5er-cli/security/advisories/new>
3. Describe the problem there. The draft and the conversation stay visible only to you and the
   maintainers.

Advisories that have been published are listed at
<https://github.com/j1nn0/a5er-cli/security/advisories>.

Private vulnerability reporting is the only reporting channel this project offers. This project
publishes no email address and no external or third-party reporting service, so please do not look
for one.

A useful report states the a5er-cli version (`a5er --version`) and how it was installed, the Node.js
version and platform, the command that was run, what was observed and what was expected, and the
smallest input that reproduces the problem. That input must be synthetic; see
[Confidentiality](#confidentiality).

## Security Scope

These areas are in scope:

- **Untrusted `.a5er` input.** The tool parses files it did not produce. A crafted or corrupted
  file must stay inside the documented handling: no code execution, no file writes, no network
  access, no reads outside the input file.
- **Parser robustness and resource exhaustion.** Inputs that hang the run, exhaust memory or the
  stack, or cost unreasonable time or space relative to their size — including inputs the parser
  accepts as valid.
- **CLI output and diagnostics.** `stdout` carries exactly one JSON envelope and prose goes to
  `stderr`. Output that a consumer can be tricked into misreading, terminal control or escape
  sequences in a message, and a failure message that reveals more than the input itself are all
  security-relevant.
- **Confidentiality of ER diagrams.** The envelope echoes names, comments and raw text from the
  file it read, so any path that exposes that content beyond the run the user asked for — files,
  logs, error messages, caches, temporary files — is security-relevant.
- **Package and supply chain.** A published tarball that does not correspond to this repository, a
  compromised release path or credential, or anything else that makes
  `npm install -g @j1nn0/a5er-cli` (or `mise use -g 'npm:@j1nn0/a5er-cli'`) deliver code that was
  not built here.

Outside this policy: vulnerabilities in A5:SQL Mk-2 itself (report them to its author), in
third-party dependencies (report them upstream; a note here is still welcome), and reports that
concern only a release this policy does not support.

## Coordinated Disclosure

The maintainer works on a report privately and coordinates the fix and its publication with the
reporter. In outline:

1. The report arrives as a private advisory draft, where it is read by the maintainer.
2. The problem is reproduced and its extent assessed. The maintainer may ask for clarification or
   for a smaller synthetic input.
3. A fix, a regression test and a release are prepared privately where that is practical.
4. The advisory and the fix are published together; the reporter is credited if they wish.

No response time, fix deadline, severity target, bounty or other service level is promised. This
project is maintained by one author on a best-effort basis. Please keep the details private until
publication is agreed, and say so in the private advisory if a problem appears to be exploited in
the wild rather than going public.

## Confidentiality

ER diagrams are confidential, and an a5er-cli envelope echoes names, comments and raw text from the
file it read.

- Do not send a real `.a5er` file, an excerpt of one, a schema derived from one, or an envelope
  produced from one — not in a report, an advisory, an issue, a log or a commit.
- Reproduce with synthetic data: minimal hand-written `.a5er` content carrying only the construct
  needed to trigger the problem.
- If the shape of a real file is what matters, describe that shape in prose instead of attaching the
  file.
