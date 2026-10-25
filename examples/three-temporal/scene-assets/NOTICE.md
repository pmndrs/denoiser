# Third-party scene models (research use)

Test scenes for the real-time denoiser pages (`?scene=sponza|bistro`, see `../CAPTURES.md` "Bistro and Sponza").
They are stored with Git LFS, skipped by default clones (`.lfsconfig`), and are not part of any published package or
the deployed examples site. Fetch them with `git lfs pull --include "examples/three-temporal/scene-assets/**" --exclude ""`.

## Sponza (`sponza/Sponza.gltf`, `sponza/Sponza.bin`)

From Khronos glTF-Sample-Assets, <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Sponza>, unmodified.

Licence: all files directly associated with the model are under the **Cryengine Limited License Agreement**
(<https://www.cryengine.com/ce-terms>; `LICENSES/LicenseRef-CRYENGINE-Agreement.txt` in that repository). Only its
metadocumentation (README, metadata.json) is CC-BY-4.0. The licence excludes logos and associated trademarks.

Attribution: © 2016, Crytek. Cryengine Limited License Agreement. Crytek for Everything. The improved Sponza Atrium
model was created by Frank Meinl, building on Marko Dabrovic's original Sponza (2002), released by Crytek, corrected in
2011 by Morgan McGuire, and converted to glTF by Khronos.

## Amazon Lumberyard Bistro, exterior (`bistro/bistro-uncompressed.glb`)

Licence: Creative Commons Attribution 4.0 International, <https://creativecommons.org/licenses/by/4.0/>.

Attribution: Amazon Lumberyard Bistro, Open Research Content Archive (ORCA), Amazon Lumberyard, 2017,
<http://developer.nvidia.com/orca/amazon-lumberyard-bistro>. CC BY 4.0. © 2017 Amazon Lumberyard.

Modified: converted from the original ORCA release to glTF by Cody Bennett (Blender glTF export). The pages use it as
geometry only: textures, UVs, tangents and the file's camera are ignored, materials are replaced by flat colours, the
one blended decal material is dropped, and alpha-cut foliage is treated as solid.
