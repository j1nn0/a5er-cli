# Third-party notices

This file records copyright and permission notices for third-party material
redistributed in this repository. It exists so vendored files keep their pinned
content and hashes unchanged while attribution obligations are satisfied at the
repository level.

The repository's own license is the MIT license in the root `LICENSE`
(Copyright (c) 2026 j1nn0). Nothing below replaces it or attributes upstream
authorship to this project.

## skill-doctor (vendored Skill)

Vendored path: `.agents/skills/skill-doctor/` (14 files, see `skills-lock.json`).

Upstream: `warpdotdev/common-skills` at pinned commit
`8792394ff1b655e0af451b8fabb68ef0cfcbd208`
(skill path `.agents/skills/skill-doctor/SKILL.md`).

Pinned upstream license source:
https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/LICENSE

The upstream repository-root license at that commit is the MIT license below,
verified byte-for-byte against the raw upstream file on 2026-11-18 (1082 bytes).
Its copyright and permission notice applies to the vendored copies and substantial
portions redistributed here, including attribution to Denver Technologies, Inc.

Upstream license text (verbatim):

```text
MIT License

Copyright (c) 2026 Denver Technologies, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Provenance and evidence:

- `skills-lock.json` pins `skill-doctor` to the commit above; all 14 vendored files
  match their upstream Git blob identities (pre-merge audit, Issue #12, finding F2).
- No tracked file previously contained the Denver notice: the root `LICENSE` names
  only j1nn0, and a case-insensitive search for "Denver" across the repository
  returned no match before this file was added.
- This notice lives outside the vendored directory, so no vendored content or hash
  was modified to add attribution.

### Bundled `assets/pierre-diffs.js`

The vendored `assets/pierre-diffs.js` bundle (1,156,623 bytes) was checked for
embedded third-party notices: word-boundary searches for `license`, `copyright`
and `MIT` return no match, and a case-insensitive search for `apache` returns only
an unrelated grammar token. The bundle references `@pierre/diffs` in one runtime
error string and carries no embedded license header.

No additional license or copyright texts were found in the vendored material by the
checks above. The upstream MIT notice reproduced here is therefore the applicable
notice for the vendored distribution as received. If upstream adds notices for
bundled components, this file must be updated rather than inventing license text.

## Out of scope

`.agents/skills/skill-creator/` already ships its own `LICENSE.txt` (Apache-2.0 with
an Anthropic notice) and is unaffected by this correction. No other vendored
third-party material was identified in this change.
