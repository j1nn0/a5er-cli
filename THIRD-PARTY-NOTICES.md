# Third-party notices

This file records copyright and permission notices for third-party material
redistributed in this repository. It exists so vendored files keep their pinned
content and hashes unchanged while attribution obligations are satisfied at the
repository level.

The repository's own license is the MIT license in the root `LICENSE`
(Copyright (c) 2026 j1nn0). Nothing below replaces it or attributes upstream
authorship to this project.

## skill-doctor (removed; historical record)

> `skill-doctor` was removed from the repository tree (`.agents/skills/skill-doctor/`
> deleted, the `.claude/skills/skill-doctor` symlink deleted, the `skills-lock.json`
> entry removed). It is no longer included or distributed here. The notices below are
> preserved unchanged as the historical record of the previously distributed
> material, including the verified bundle-component notices.

Former vendored path: `.agents/skills/skill-doctor/` (14 files at removal; the `skills-lock.json` entry has been removed).

Upstream: `warpdotdev/common-skills` at pinned commit
`8792394ff1b655e0af451b8fabb68ef0cfcbd208`
(skill path `.agents/skills/skill-doctor/SKILL.md`).

Pinned upstream license source:
https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/LICENSE

The upstream repository-root license at that commit is the MIT license below,
verified byte-for-byte against the raw upstream file on 2026-11-18 (1082 bytes).
Its copyright and permission notice applies to the vendored skill files
redistributed here, including attribution to Denver Technologies, Inc.

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

- At distribution time, `skills-lock.json` pinned `skill-doctor` to the commit above;
  all 14 vendored files matched their upstream Git blob identities (pre-merge audit,
  Issue #12, finding F2). The lock entry has since been removed with the Skill itself.
- No tracked file previously contained the Denver notice: the root `LICENSE` names
  only j1nn0, and a case-insensitive search for "Denver" across the repository
  returned no match before `THIRD-PARTY-NOTICES.md` was added.
- This notice lives outside the vendored directory, so no vendored content or hash
  was modified to add attribution.

### Embedded components in `assets/pierre-diffs.js`

Correction: the Denver MIT notice above covers the skill-doctor files as
distributed by `warpdotdev/common-skills`, but it does **not** cover the
third-party components embedded in the `assets/pierre-diffs.js` bundle
(1,156,623 bytes). The notices below apply to those components. This corrects
the earlier claim that the upstream MIT notice alone was sufficient.

Inventory:

| Embedded component                                      | Match confidence                                             | License                                                                 | Notice |
| ------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | ------ |
| Oniguruma WebAssembly build (via `vscode-oniguruma`)    | Exact artifact match                                         | Oniguruma license (BSD-2-Clause redistribution conditions + disclaimer) | §1     |
| Shiki highlighting code (incl. `@shikijs/transformers`) | Strong code match; exact bundled version unconfirmed         | MIT (Pine Wu, Anthony Fu)                                               | §2     |
| Pierre Diffs code                                       | Present in bundle; exact bundled package version unconfirmed | Apache-2.0 (Pierre Computer Company)                                    | §3     |

Affected bundle in all rows: `.agents/skills/skill-doctor/assets/pierre-diffs.js`.
No vendored bundle bytes were changed; all notices live in this file.

#### 1. Oniguruma — exact artifact match

- Identification: the bundle contains one 622,148-character base64 payload that
  decodes to a 466,610-byte WebAssembly module (`\0asm` magic) with SHA-256
  `fd885c2d12e5951e59d761ebd4a006e06254b1491fd6f530c92b69fb4d8d77d9`.
  Those bytes are identical to `release/onig.wasm` of npm
  `vscode-oniguruma@1.7.0` (verified by direct comparison on 2026-11-18).
- Upstream: https://github.com/microsoft/vscode-oniguruma — the notice below is
  the full `NOTICES.txt` at tag `v1.7.0`:
  https://github.com/microsoft/vscode-oniguruma/blob/v1.7.0/NOTICES.txt
  The applicable part is the "Oniguruma LICENSE" section (oniguruma
  `6.9.5_rev1`, https://github.com/kkos/oniguruma/tree/v6.9.5_rev1):
  Copyright (c) 2002-2020 K.Kosako, BSD-2-Clause redistribution conditions
  and disclaimer.
- The redistribution condition for binary form (reproduce the copyright
  notice, conditions and disclaimer in documentation/materials) is satisfied
  by this section.

```text
THIRD-PARTY SOFTWARE NOTICES AND INFORMATION
Do Not Translate or Localize

This project incorporates material from the project(s) listed below (collectively, “Third Party Code”).
Microsoft is not the original author of the Third Party Code.  The original copyright notice and license
under which Microsoft received such Third Party Code are set out below. This Third Party Code is licensed
to you under their original license terms set forth below.  Microsoft reserves all other rights not
expressly granted, whether by implication, estoppel or otherwise.

The following files/folders contain third party software:

=========================================================================================================
deps/oniguruma/ --- oniguruma version 6.9.5_rev1 https://github.com/kkos/oniguruma/tree/v6.9.5_rev1
---------------------------------------------------------------------------------------------------------

Oniguruma LICENSE
-----------------

Copyright (c) 2002-2020  K.Kosako  <kkosako0@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
SUCH DAMAGE.
```

#### 2. Shiki — strong code match; exact bundled version unconfirmed

- Evidence: the bundle contains Shiki runtime code (`__shiki_resolved`,
  `shiki-themes`, `shiki:decorations`, the `shiki-js` engine default and
  `createOnigurumaEngine` engine selection) and the
  `@shikijs/transformers:style-to-class` transformer identifier. The bundle
  carries no Shiki version string and no embedded Shiki copyright text, so
  the exact bundled Shiki version is **not** confirmed and is not claimed
  here. Corroboration (not bundled-version proof): the upstream
  `@pierre/diffs` package declares a `shiki` dependency range
  `^3.0.0 || ^4.0.0`.
- Notice source (reviewer-referenced):
  https://github.com/shikijs/shiki/blob/v3.23.0/LICENSE — MIT, Copyright
  (c) 2021 Pine Wu and Copyright (c) 2023 Anthony Fu. Applied here as the
  applicable MIT notice for the Shiki code in the bundle.

```text
MIT License

Copyright (c) 2021 Pine Wu
Copyright (c) 2023 Anthony Fu <https://github.com/antfu>

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

#### 3. Pierre Diffs — present; exact bundled package version unconfirmed

- Evidence: the bundle's render path references `@pierre/diffs` (the
  highlighter diff renderer the bundle is built around). The bundle carries
  no package version string, so the exact bundled `@pierre/diffs` version
  is **not** confirmed and is not claimed here. For provenance only: the
  current upstream `main` package metadata names `@pierre/diffs` with
  license `apache-2.0` — cited as the package identity, not as the bundled
  version.
- License source:
  https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/LICENSE.md
  — Apache License, Version 2.0, with the appendix
  "Copyright 2025 Pierre Computer Company".
- NOTICE check (2026-11-18): no `NOTICE` or `NOTICE.md` exists in upstream
  `packages/diffs/` or the repository root (all requests 404), and the
  package directory lists only `LICENSE.md` next to it. No additional
  upstream attribution file accompanies the redistributed component, so
  none is reproduced here. If upstream adds one, this file must be updated.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1.  Definitions.

    "License" shall mean the terms and conditions for use, reproduction, and
    distribution as defined by Sections 1 through 9 of this document.

    "Licensor" shall mean the copyright owner or entity authorized by the
    copyright owner that is granting the License.

    "Legal Entity" shall mean the union of the acting entity and all other
    entities that control, are controlled by, or are under common control with
    that entity. For the purposes of this definition, "control" means (i) the
    power, direct or indirect, to cause the direction or management of such
    entity, whether by contract or otherwise, or (ii) ownership of fifty percent
    (50%) or more of the outstanding shares, or (iii) beneficial ownership of
    such entity.

    "You" (or "Your") shall mean an individual or Legal Entity exercising
    permissions granted by this License.

    "Source" form shall mean the preferred form for making modifications,
    including but not limited to software source code, documentation source, and
    configuration files.

    "Object" form shall mean any form resulting from mechanical transformation
    or translation of a Source form, including but not limited to compiled
    object code, generated documentation, and conversions to other media types.

    "Work" shall mean the work of authorship, whether in Source or Object form,
    made available under the License, as indicated by a copyright notice that is
    included in or attached to the work (an example is provided in the Appendix
    below).

    "Derivative Works" shall mean any work, whether in Source or Object form,
    that is based on (or derived from) the Work and for which the editorial
    revisions, annotations, elaborations, or other modifications represent, as a
    whole, an original work of authorship. For the purposes of this License,
    Derivative Works shall not include works that remain separable from, or
    merely link (or bind by name) to the interfaces of, the Work and Derivative
    Works thereof.

    "Contribution" shall mean any work of authorship, including the original
    version of the Work and any modifications or additions to that Work or
    Derivative Works thereof, that is intentionally submitted to Licensor for
    inclusion in the Work by the copyright owner or by an individual or Legal
    Entity authorized to submit on behalf of the copyright owner. For the
    purposes of this definition, "submitted" means any form of electronic,
    verbal, or written communication sent to the Licensor or its
    representatives, including but not limited to communication on electronic
    mailing lists, source code control systems, and issue tracking systems that
    are managed by, or on behalf of, the Licensor for the purpose of discussing
    and improving the Work, but excluding communication that is conspicuously
    marked or otherwise designated in writing by the copyright owner as "Not a
    Contribution."

    "Contributor" shall mean Licensor and any individual or Legal Entity on
    behalf of whom a Contribution has been received by Licensor and subsequently
    incorporated within the Work.

2.  Grant of Copyright License. Subject to the terms and conditions of this
    License, each Contributor hereby grants to You a perpetual, worldwide,
    non-exclusive, no-charge, royalty-free, irrevocable copyright license to
    reproduce, prepare Derivative Works of, publicly display, publicly perform,
    sublicense, and distribute the Work and such Derivative Works in Source or
    Object form.

3.  Grant of Patent License. Subject to the terms and conditions of this
    License, each Contributor hereby grants to You a perpetual, worldwide,
    non-exclusive, no-charge, royalty-free, irrevocable (except as stated in
    this section) patent license to make, have made, use, offer to sell, sell,
    import, and otherwise transfer the Work, where such license applies only to
    those patent claims licensable by such Contributor that are necessarily
    infringed by their Contribution(s) alone or by combination of their
    Contribution(s) with the Work to which such Contribution(s) was submitted.
    If You institute patent litigation against any entity (including a
    cross-claim or counterclaim in a lawsuit) alleging that the Work or a
    Contribution incorporated within the Work constitutes direct or contributory
    patent infringement, then any patent licenses granted to You under this
    License for that Work shall terminate as of the date such litigation is
    filed.

4.  Redistribution. You may reproduce and distribute copies of the Work or
    Derivative Works thereof in any medium, with or without modifications, and
    in Source or Object form, provided that You meet the following conditions:

    (a) You must give any other recipients of the Work or Derivative Works a
    copy of this License; and

    (b) You must cause any modified files to carry prominent notices stating
    that You changed the files; and

    (c) You must retain, in the Source form of any Derivative Works that You
    distribute, all copyright, patent, trademark, and attribution notices from
    the Source form of the Work, excluding those notices that do not pertain to
    any part of the Derivative Works; and

    (d) If the Work includes a "NOTICE" text file as part of its distribution,
    then any Derivative Works that You distribute must include a readable copy
    of the attribution notices contained within such NOTICE file, excluding
    those notices that do not pertain to any part of the Derivative Works, in at
    least one of the following places: within a NOTICE text file distributed as
    part of the Derivative Works; within the Source form or documentation, if
    provided along with the Derivative Works; or, within a display generated by
    the Derivative Works, if and wherever such third-party notices normally
    appear. The contents of the NOTICE file are for informational purposes only
    and do not modify the License. You may add Your own attribution notices
    within Derivative Works that You distribute, alongside or as an addendum to
    the NOTICE text from the Work, provided that such additional attribution
    notices cannot be construed as modifying the License.

    You may add Your own copyright statement to Your modifications and may
    provide additional or different license terms and conditions for use,
    reproduction, or distribution of Your modifications, or for any such
    Derivative Works as a whole, provided Your use, reproduction, and
    distribution of the Work otherwise complies with the conditions stated in
    this License.

5.  Submission of Contributions. Unless You explicitly state otherwise, any
    Contribution intentionally submitted for inclusion in the Work by You to the
    Licensor shall be under the terms and conditions of this License, without
    any additional terms or conditions. Notwithstanding the above, nothing
    herein shall supersede or modify the terms of any separate license agreement
    you may have executed with Licensor regarding such Contributions.

6.  Trademarks. This License does not grant permission to use the trade names,
    trademarks, service marks, or product names of the Licensor, except as
    required for reasonable and customary use in describing the origin of the
    Work and reproducing the content of the NOTICE file.

7.  Disclaimer of Warranty. Unless required by applicable law or agreed to in
    writing, Licensor provides the Work (and each Contributor provides its
    Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied, including, without limitation, any
    warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or
    FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining
    the appropriateness of using or redistributing the Work and assume any risks
    associated with Your exercise of permissions under this License.

8.  Limitation of Liability. In no event and under no legal theory, whether in
    tort (including negligence), contract, or otherwise, unless required by
    applicable law (such as deliberate and grossly negligent acts) or agreed to
    in writing, shall any Contributor be liable to You for damages, including
    any direct, indirect, special, incidental, or consequential damages of any
    character arising as a result of this License or out of the use or inability
    to use the Work (including but not limited to damages for loss of goodwill,
    work stoppage, computer failure or malfunction, or any and all other
    commercial damages or losses), even if such Contributor has been advised of
    the possibility of such damages.

9.  Accepting Warranty or Additional Liability. While redistributing the Work or
    Derivative Works thereof, You may choose to offer, and charge a fee for,
    acceptance of support, warranty, indemnity, or other liability obligations
    and/or rights consistent with this License. However, in accepting such
    obligations, You may act only on Your own behalf and on Your sole
    responsibility, not on behalf of any other Contributor, and only if You
    agree to indemnify, defend, and hold each Contributor harmless for any
    liability incurred by, or claims asserted against, such Contributor by
    reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

Copyright 2025 Pierre Computer Company

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
```

### What was and was not verified

- Verified on 2026-11-18: the exact Oniguruma wasm bytes and SHA-256 against
  both the reviewer's figures and the official npm `vscode-oniguruma@1.7.0`
  artifact; the three upstream notice texts fetched from their authoritative
  refs above; the absence of an upstream NOTICE file for Pierre Diffs; the
  absence of version strings and embedded copyright texts inside the bundle
  (word-boundary searches for `license`, `copyright`, `MIT` return no match;
  the bundle references `@pierre/diffs` only in a runtime error string).
- Not verified / unresolved: the exact bundled Shiki version; the exact
  bundled `@pierre/diffs` version. No other transitive minified dependency
  has been shown to be included, so no further notices are demanded — and
  no claim of complete license compliance beyond the evidence above is made.
- The absence of license keywords inside minified JavaScript was previously
  (incorrectly) read as positive evidence; it is not treated that way here.

## Out of scope

`.agents/skills/skill-creator/` already ships its own `LICENSE.txt` (Apache-2.0 with
an Anthropic notice) and is unaffected by this correction. No other vendored
third-party material was identified in this change.
