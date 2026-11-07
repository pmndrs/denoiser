# G5 asset: Flight Helmet

Source: KhronosGroup/glTF-Sample-Models, `2.0/FlightHelmet/glTF` (clone at commit
`16e803435fca5b07dde3dbdc5bd0e9b8374b2750`; the same model is in glTF-Sample-Assets `Models/FlightHelmet`).

Licence: **CC0 1.0** (public domain dedication). Its README says: "Donated by Microsoft for glTF testing ... To the
extent possible under law, Microsoft has waived all copyright and related or neighboring rights to this asset."
https://creativecommons.org/publicdomain/zero/1.0/

Modified (permitted, for repository size): the 2048x2048 PNG textures (4096x4096 base maps) were downscaled to at most 1024 px
on the long side and re-encoded as JPEG quality 90 (`sips -Z 1024 -s format jpeg -s formatOptions 90`); the `.gltf`'s
image URIs point at the `.jpg` files (mimeType entries removed). Geometry (`FlightHelmet.bin`) is unmodified.
The scene forces the lens material opaque (the denoiser test bed has no blending).

Why this model: six materials with base-colour, normal and occlusion-roughness-metalness maps covering glossy
dielectric (lenses, glass/plastic), rough dielectric (leather, rubber, wood), and polished and brushed metal parts.
