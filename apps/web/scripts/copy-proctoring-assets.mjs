// Copies MediaPipe's WebAssembly runtime into public/proctoring/wasm (not committed: about 23 MB), so the
// camera proctoring in the quiz player loads it from this app rather than a third-party CDN. Runs before
// `next dev` and `next build`. The face model (public/proctoring/blaze_face_short_range.tflite) is committed.
import { copyFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The entry point sits at the package root, next to wasm/.
const pkg = path.dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision'));
const out = path.join(here, '..', 'public', 'proctoring', 'wasm');
mkdirSync(out, { recursive: true });
// The loader picks the SIMD build when the browser supports it, the other one otherwise.
for (const name of ['vision_wasm_internal', 'vision_wasm_nosimd_internal']) {
  for (const ext of ['js', 'wasm']) copyFileSync(path.join(pkg, 'wasm', `${name}.${ext}`), path.join(out, `${name}.${ext}`));
}
