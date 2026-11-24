# /// script
# requires-python = ">=3.12"
# dependencies = ["mediapipe>=1.2", "numpy>=2"]
# ///
"""The pixels of `studio grade`: a face-aware grade for a camera track. library-grade.ts plans the work and runs this
once per chunk; the look and the gains arrive as JSON, worked out in library-grade.ts's models, so every number a
person tunes lives in TypeScript.

    measure  sampled frames' mean linear colour: background, skin, and the parsed face's skin and two halves
    grade    a stretch of frames graded to an H.264 file with no sound (`--skip` frames warm the masks, unwritten)
    still    one frame, before and after side by side, as a JPEG
    check    the colour maths (Cineon encoding, .cube reading) asserted, for library-grade-colour.test.ts

The person comes off the background with MediaPipe's multiclass selfie segmenter (Apache-2.0); the face's skin, less
the beard, with a BiSeNet face parser (yakhyo/face-parsing resnet18, MIT) run through OpenCV's DNN, since onnxruntime
lags new Pythons. Both download once into --models, checked by hash. Mixed light (a cool monitor on the face, a warm
room behind) is why the person and background each pull toward their own target.
"""
import argparse, hashlib, json, re, subprocess, sys, urllib.request
from pathlib import Path
import numpy as np, cv2
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

MODELS = {
    "selfie_multiclass_256x256.tflite": ("https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
                                         "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0"),
    "faceparse_resnet18.onnx": ("https://github.com/yakhyo/face-parsing/releases/download/v0.0.1/resnet18.onnx",
                                "0d9bd318e46987c3bdbfacae9e2c0f461cae1c6ac6ea6d43bbe541a91727e33f"),
}
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
# How often the masks are remade: segmenting every frame triples the cost and the masks are smoothed over time anyway.
SEGMENT_EVERY = 3


def model_path(models: Path, name: str) -> str:
    path = models / name
    if not path.exists():
        url, sha = MODELS[name]
        models.mkdir(parents=True, exist_ok=True)
        print(f"downloading {name}", file=sys.stderr)
        part = path.with_suffix(".part")
        urllib.request.urlretrieve(url, part)
        got = hashlib.sha256(part.read_bytes()).hexdigest()
        if got != sha: part.unlink(); sys.exit(f"{name} from {url} isn't the model this grade was tuned on (sha256 {got})")
        part.rename(path)
    return str(path)


def to_lin(x): return np.power(np.clip(x, 0, 1), 2.2)
def to_gam(x): return np.power(np.clip(x, 0, 1), 1 / 2.2)


def read_frames(src, ss, count, w, h, fps):
    """`count` frames from media second `ss`, resampled to a constant `fps`, as RGB arrays. The rate's grid starts
    at `ss` itself, not at the first frame after it, so chunks read separately join on one grid."""
    cmd = ["ffmpeg", "-loglevel", "error", "-ss", f"{ss:.6f}", "-i", src, "-vf", f"fps={fps}:start_time=0,scale={w}:{h}",
           "-frames:v", str(count), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = w * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n: break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)
    p.wait()


class Segmenter:
    def __init__(self, models, w, h):
        opts = vision.ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=model_path(models, "selfie_multiclass_256x256.tflite")),
                                            output_confidence_masks=True)
        self.seg = vision.ImageSegmenter.create_from_options(opts); self.w, self.h = w, h

    def masks(self, rgb):
        """(person, skin, face-skin) confidences at frame size."""
        res = self.seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
        c = [m.numpy_view() for m in res.confidence_masks]  # 0 bg, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 other
        size = (self.w, self.h)
        return cv2.resize(1 - c[0], size), cv2.resize(c[2] + c[3], size), cv2.resize(c[3], size)


class FaceParser:
    """BiSeNet over CelebAMask-HQ's 19 classes: 1 skin, 10 nose, 14 neck, 17 hair... It has no beard class: a beard
    lands in skin, so masks_from_parse splits it out."""
    MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)

    def __init__(self, models):
        self.net = cv2.dnn.readNetFromONNX(model_path(models, "faceparse_resnet18.onnx"))

    def parse(self, rgb_crop):
        """Per-class probabilities at 512x512."""
        x = cv2.resize(rgb_crop, (512, 512), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
        self.net.setInput(np.ascontiguousarray(((x - self.MEAN) / self.STD).transpose(2, 0, 1)[None]))
        logits = self.net.forward()[0]
        probs = np.exp(logits - logits.max(0))
        return probs / probs.sum(0)


def face_box(face_skin, w, h, pad=0.9):
    """A square around the segmenter's face skin, padded to take in hair, ears and neck."""
    ys, xs = np.where(face_skin > 0.5)
    if len(xs) < 200: return None
    cx, cy = xs.mean(), ys.mean()
    s = max(xs.max() - xs.min(), ys.max() - ys.min()) * (1 + pad)
    x0 = int(max(0, cx - s / 2)); y0 = int(max(0, cy - s / 2 + s * 0.08))
    return x0, y0, int(min(w, x0 + s)), int(min(h, y0 + s))


SKINLIKE = [1, 10, 14]  # skin, nose, neck. Not ears: the parser calls headphone cups ears.


def masks_from_parse(probs, rgb_crop):
    """(skin, beard) at 512x512. The beard is dark, textured skin below the nose, judged against the crop's own
    median skin so it survives exposure changes."""
    x = cv2.resize(rgb_crop, (512, 512)).astype(np.float32) / 255.0
    luma = x @ LUMA
    core = probs[1] > 0.5
    if core.sum() < 300: return None
    med = np.median(luma[core])
    tex = cv2.GaussianBlur(np.abs(luma - cv2.GaussianBlur(luma, (0, 0), 2.0)), (0, 0), 3.0)  # beard hair is high-frequency
    tex_med = np.median(tex[core])
    dark = np.clip((med * 0.82 - luma) / (med * 0.25), 0, 1)
    rough = np.clip((tex - tex_med * 1.3) / (tex_med * 1.5 + 1e-6), 0, 1)
    nose = probs[10] > 0.5
    ny = np.where(nose)[0].mean() if nose.sum() > 50 else 256
    below = np.clip((np.arange(512)[:, None] - (ny + 10)) / 25.0, 0, 1)
    beard = np.clip(0.6 * dark + 0.6 * rough, 0, 1) * below * probs[[1, 14]].sum(0)
    beard = cv2.morphologyEx(beard, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    beard = np.clip(cv2.GaussianBlur(beard, (0, 0), 4) * 1.6, 0, 1)
    return np.clip(probs[SKINLIKE].sum(0) - beard, 0, 1), beard


class FaceMasks:
    """The parsed skin in frame coordinates, smoothed over time (`ema`) inside a steadied crop, and where the face's
    middle is, so its two halves can be told apart."""
    def __init__(self, parser, w, h, ema=0.5):
        self.fp, self.w, self.h, self.ema = parser, w, h, ema
        self.box = self.skin = None; self.cx = w / 2; self.fw = 200; self.seen = 0

    def update(self, f, person, face_skin):
        b = face_box(face_skin, self.w, self.h)
        if b is None: return
        b = np.array(b, np.float32)
        self.box = b if self.box is None else 0.7 * self.box + 0.3 * b  # a steady crop: less mask shimmer
        x0, y0, x1, y1 = self.box.astype(int)
        crop = f[y0:y1, x0:x1]
        probs = self.fp.parse(crop)
        r = masks_from_parse(probs, crop)
        if r is None: return
        sk = r[0]
        nose = np.where(probs[10] > 0.5)
        nose_x = x0 + nose[1].mean() * (x1 - x0) / 512 if len(nose[1]) > 50 else None
        full = np.zeros((self.h, self.w), np.float32)
        full[y0:y1, x0:x1] = cv2.resize(sk, (x1 - x0, y1 - y0))
        full = cv2.GaussianBlur(full * np.clip(person * 1.2, 0, 1), (0, 0), 3)  # inside the matte, feathered
        self.skin = full if self.skin is None else self.ema * self.skin + (1 - self.ema) * full
        ys, xs = np.where(self.skin > 0.5)
        if len(xs) > 500:
            cx = nose_x if nose_x is not None else np.median(xs)  # the nose, not the skin's median: the neck skews it
            self.cx = cx if self.seen == 0 else 0.7 * self.cx + 0.3 * cx; self.seen += 1
            self.fw = 0.7 * self.fw + 0.3 * (np.percentile(xs, 95) - np.percentile(xs, 5))

    def ramp(self):
        """0 on the frame-left half of the face, 1 on the right, blended across its middle third."""
        x = np.arange(self.w, dtype=np.float32)
        return np.clip((x - (self.cx - self.fw / 6)) / (self.fw / 3), 0, 1)[None, :]


def measure(a):
    """Mean linear RGB over sampled frames: what library-grade.ts turns into gains."""
    models = Path(a.models); seg = Segmenter(models, a.width, a.height); parser = FaceParser(models)
    bg, skin, face, left, right = [], [], [], [], []
    for t in a.times.split(","):
        f = next(read_frames(a.src, float(t), 1, a.width, a.height, a.fps), None)
        if f is None: continue
        lin = to_lin(f / 255.0)
        person, sk, face_skin = seg.masks(f)
        if (person < 0.1).sum() > 1000: bg.append(lin[person < 0.1].mean(0))
        if (sk > 0.7).sum() > 500: skin.append(lin[sk > 0.7].mean(0))
        fm = FaceMasks(parser, a.width, a.height, ema=0)
        fm.update(f, person, face_skin)
        if fm.skin is None: continue
        m = fm.skin > 0.7
        face.append(lin[m].mean(0))
        rr = fm.ramp()[0]
        lm = m & (rr[None, :] == 0); rm = m & (rr[None, :] == 1)
        if lm.sum() > 300 and rm.sum() > 300: left.append(lin[lm].mean(0)); right.append(lin[rm].mean(0))
    if not bg or not skin: sys.exit(f"no person found in the {len(a.times.split(','))} frames sampled")
    out = {"sampled": len(bg), "background": np.mean(bg, 0).tolist(), "skin": np.mean(skin, 0).tolist()}
    if face and left: out["face"] = {"skin": np.mean(face, 0).tolist(), "left": np.mean(left, 0).tolist(), "right": np.mean(right, 0).tolist()}
    print(json.dumps(out))


def load_cube(lines):
    """A 3D .cube's table, from its lines, indexed lut[b, g, r] (the format runs red fastest). Its LUT_3D_INPUT_RANGE and other
    keywords are skipped: the film LUTs here take 0–1 Cineon, which is the range apply_cube assumes."""
    rows, size = [], None
    for line in lines:
        t = line.split()
        if not t or t[0].startswith('#'): continue
        if t[0] == 'LUT_3D_SIZE': size = int(t[1])
        elif re.match(r'^[-0-9.]', t[0]) and len(t) == 3: rows.append([float(v) for v in t])
    return np.array(rows, np.float32).reshape(size, size, size, 3)


# Kodak's Cineon printing density: code 95 is black, 685 is white (90% reflectance), 0.002 density a code, negative
# gamma 0.6. Linear 0.18 lands near code 470.
CINEON_BLACK, CINEON_WHITE = 95, 685
CINEON_OFFSET = 10 ** ((CINEON_BLACK - CINEON_WHITE) * 0.002 / 0.6)


def cineon_from_display(d):
    """Camera display values (0–1) as 0–1 Cineon log, what a film LUT takes. The camera's curve is undone as Rec.709's
    (exact for PP3's ITU709 and close for PP1's Movie gamma; only approximate for PP5's Cine1, which bends highlights
    its own way), back to scene linear, then encoded as Cineon."""
    d = np.clip(d, 0, 1)
    lin = np.where(d < 0.081, d / 4.5, ((d + 0.099) / 1.099) ** (1 / 0.45))
    code = CINEON_WHITE + 300 * np.log10(lin * (1 - CINEON_OFFSET) + CINEON_OFFSET)
    return np.clip(code / 1023, 0, 1)


def apply_cube(d, lut):
    n = lut.shape[0] - 1
    x = np.clip(d, 0, 1) * n
    i0 = np.floor(x).astype(np.int32); i1 = np.minimum(i0 + 1, n); f = x - i0
    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]; r1, g1, b1 = i1[..., 0], i1[..., 1], i1[..., 2]
    fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]
    c00 = lut[b0, g0, r0] * (1 - fr) + lut[b0, g0, r1] * fr
    c01 = lut[b0, g1, r0] * (1 - fr) + lut[b0, g1, r1] * fr
    c10 = lut[b1, g0, r0] * (1 - fr) + lut[b1, g0, r1] * fr
    c11 = lut[b1, g1, r0] * (1 - fr) + lut[b1, g1, r1] * fr
    return (c00 * (1 - fg) + c01 * fg) * (1 - fb) + (c10 * (1 - fg) + c11 * fg) * fb


def curve(x, contrast):
    """A filmic S around mid-grey 0.45 in display space; 0 is no change."""
    if contrast == 0: return x
    k = 1 + contrast * 4
    s = 1 / (1 + np.exp(-k * (x - 0.45)))
    lo, hi = 1 / (1 + np.exp(k * 0.45)), 1 / (1 + np.exp(-k * 0.55))
    return (s - lo) / (hi - lo)


class Grader:
    def __init__(self, a):
        self.look, g = json.loads(a.look), json.loads(a.gains)
        self.bg_gain, self.skin_gain, self.balance = (np.array(g[k]) for k in ("background", "skin", "balance"))
        models = Path(a.models); self.w, self.h = a.width, a.height
        self.seg = Segmenter(models, a.width, a.height)
        self.fm = FaceMasks(FaceParser(models), a.width, a.height) if self.look.get("face") else None
        lut = self.look.get("lut")
        self.lut = (load_cube(open(Path(a.luts) / lut["file"])), lut["mix"]) if lut else None
        self.vign = None
        if self.look["vignette"]:
            yy, xx = np.mgrid[0:self.h, 0:self.w]
            r = np.sqrt(((xx - self.w / 2) / (self.w / 2)) ** 2 + ((yy - self.h * 0.45) / (self.h / 2)) ** 2)
            self.vign = 1 - self.look["vignette"] * np.clip((r - 0.5) / 0.9, 0, 1) ** 1.6
        self.person = None; self.n = 0

    def next(self, f):
        """`f` graded, its masks carried on from the frames before."""
        if self.n % SEGMENT_EVERY == 0:
            person, _, face_skin = self.seg.masks(f)
            person = cv2.GaussianBlur(person, (0, 0), 6)
            self.person = person if self.person is None else 0.5 * self.person + 0.5 * person
            if self.fm is not None: self.fm.update(f, self.person, face_skin)
        self.n += 1
        return self.grade(f)

    def grade(self, f):
        L = self.look
        lin = to_lin(f / 255.0)
        g_bg = 1 + (self.bg_gain - 1) * L["background"]["strength"]
        g_p = 1 + (self.skin_gain - 1) * L["skin"]["strength"]
        pm = self.person[..., None]
        if self.fm is not None and self.fm.skin is not None:
            # Hair, beard and shirt take a share of the skin's correction, so the face doesn't part from the head;
            # skin takes all of it, and its frame-left and frame-right halves move toward each other.
            sm = self.fm.skin[..., None]
            g_rest = 1 + (self.skin_gain - 1) * L["skin"]["strength"] * L["face"]["restShare"]
            g_skin = g_p * np.power(self.balance, L["face"]["balance"] * (self.fm.ramp()[..., None] - 0.5))
            out = lin * (g_bg * (1 - pm) + (g_rest * (1 - sm) + g_skin * sm) * pm)
        else:
            out = lin * (g_bg * (1 - pm) + g_p * pm)
        out *= L["exposure"] * ((1 - pm) * L["background"]["level"] + pm)
        d = to_gam(out)
        if self.lut is not None:  # a film LUT reads Cineon log, so the corrected picture is re-encoded for it
            d = d * (1 - self.lut[1]) + apply_cube(cineon_from_display(d), self.lut[0]) * self.lut[1]
        d = curve(d, L["contrast"])
        if L["split"]:  # teal shadows, warm highlights
            luma = d @ LUMA
            sh = np.clip(1 - luma / 0.5, 0, 1)[..., None]; hl = np.clip((luma - 0.5) / 0.5, 0, 1)[..., None]
            d = d + L["split"] * (sh * np.array([-0.6, 0.1, 0.5]) + hl * np.array([0.4, 0.1, -0.5])) * 0.1
        luma = (d @ LUMA)[..., None]
        d = luma + (d - luma) * L["saturation"]
        if self.vign is not None: d = d * self.vign[..., None]
        return np.clip(d * 255 + 0.5, 0, 255).astype(np.uint8)


def grade(a):
    g = Grader(a)
    enc = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{a.width}x{a.height}",
                            "-r", a.fps, "-i", "-", "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-pix_fmt", "yuv420p", a.out],
                           stdin=subprocess.PIPE)
    written = 0
    for i, f in enumerate(read_frames(a.src, a.ss, a.skip + a.frames, a.width, a.height, a.fps)):
        img = g.next(f)
        if i >= a.skip: enc.stdin.write(img.tobytes()); written += 1
    enc.stdin.close()
    if enc.wait() != 0: sys.exit("the encoder failed")
    if written != a.frames: sys.exit(f"the source gave {written} of {a.frames} frames from {a.ss:.3f} s")


def still(a):
    g = Grader(a)
    last = None
    for f in read_frames(a.src, a.ss, a.skip + 1, a.width, a.height, a.fps):
        last = (f, g.next(f))
    if last is None: sys.exit(f"the source has no frame at {a.ss:.3f} s")
    cv2.imwrite(a.out, cv2.cvtColor(np.hstack(last), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])


def check(a):
    """The colour maths a grade can't be eyeballed for: Cineon's mid-grey, and a Resolve-style .cube read whole."""
    mid = 1.099 * 0.18 ** 0.45 - 0.099  # linear 0.18 as Rec.709 display
    code = float(cineon_from_display(np.array(mid))) * 1023
    assert abs(code - 470) < 6, f"18% grey at Cineon code {code:.1f}, not about 470"
    cube = ["# t", "LUT_3D_SIZE 2", "LUT_3D_INPUT_RANGE 0.0 1.0", ""] + [f"{r} {g} {b}" for b in (0, 1) for g in (0, 1) for r in (0, 1)]
    lut = load_cube(cube)
    assert lut.shape == (2, 2, 2, 3), lut.shape
    probe = np.array([[0.25, 0.5, 0.75]], np.float32)
    assert np.allclose(apply_cube(probe, lut), probe), apply_cube(probe, lut)
    print(json.dumps({"cineonMidGrey": round(code, 1)}))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["measure", "grade", "still", "check"])
    p.add_argument("--src"); p.add_argument("--models")
    p.add_argument("--width", type=int); p.add_argument("--height", type=int)
    p.add_argument("--fps", default="30000/1001")
    p.add_argument("--times", help="measure: media seconds to sample, comma-separated")
    p.add_argument("--ss", type=float, help="media second of the first frame read")
    p.add_argument("--skip", type=int, default=0, help="frames read to warm the masks, not written")
    p.add_argument("--frames", type=int, help="frames written")
    p.add_argument("--look"); p.add_argument("--gains"); p.add_argument("--luts"); p.add_argument("--out")
    a = p.parse_args()
    {"measure": measure, "grade": grade, "still": still, "check": check}[a.mode](a)


if __name__ == "__main__":
    main()
