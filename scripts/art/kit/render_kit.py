"""
Render 3D prop kits to decor sprites from the game camera (docs/DECOR.md "3D kits").

Run with Blender's Python module (pip install bpy==5.2.3, Python 3.13), not Node:
  python render_kit.py <kit.glb> <out dir> <pieces.json>
Writes <out>/<piece>/<piece>_<v>.png: one PNG per variant, transparent, at the Lords of Pain decor scale
(art/atlases.json worldArt pixelsPerTileFrom), ready for the atlas pipeline as single-frame world art.

Camera: orthographic, 55 degrees below the horizon (shared/config CAMERA_PITCH_DEG); a variant's `az` turns the
camera round the piece (-45 = the game's view of an unrotated piece). Light: one sun from the camera's upper left
plus a dim ambient, so pieces shade like Lords of Pain's renders. Each variant renders at RENDER_PPU (kit units per
pixel inverse; `keepHeight` drops the geometry more than that many kit units above the piece's lowest point, e.g. a
chandelier's chain) and is reduced (premultiplied, Lanczos) so its visible body is `sizePx` across (`fit` "width") or
along its longest side (`fit` "long"), then graded toward Lords of Pain (`grade`: saturation, brightness, contrast,
warm tint; a piece's own `grade` overrides the kit's fields; `fit` "box" with `sizePx` [w, h] fits inside both;
`fit` "world" with `unitsPerTile` draws it at world scale: that many kit units to a tile). `pivotOut` writes
<png>.pivot.json, the footprint's centre on the floor in the PNG's pixels (atlases.json `pivot: [x, y]`).
A piece's variants are its `az` list (camera turns); `rotZ` (same length) turns the piece itself instead, about its
centre, for a wall piece that must face a wall normal; `files` names each variant's PNG (default <piece>_<v>.png),
and `copies` adds files copied from rendered ones (a sprite set's never-shown facings). `sunSide` (same length, default
1 each) places each variant's sun: 1 from the camera's upper left (as every piece), -1 mirrored to its upper right (a
facing whose front the usual sun leaves in shadow: the bookcase facing +X), 0 straight from behind the camera.
Set pieces built from several meshes (docs/DECOR.md "Room themes"): `region` {"min": [x, y, z], "max": [x, y, z]}
adds every mesh whose box centre lies inside (kit world units; `exclude` drops names starting with any listed prefix),
`moves` {object: [dx, dy, dz]} shifts objects first (a throne seated on its dais), and `pivotAt` [x, y] is the
footprint's centre on the floor (after the moves, before `rotZ`; default the group box's centre) for `pivotOut`.
"""
import bpy, json, math, os, shutil, sys
import bmesh  # after bpy: the module only exists once bpy has loaded
from mathutils import Matrix, Vector
import numpy as np
from PIL import Image, ImageEnhance

RENDER_PPU = 2.0
# the Lords of Pain decor scale (art/atlases.json worldArt pixelsPerTileFrom): pixels per tile on the billboard
TILE_PX = 29.6
PITCH_DEG = 55.0


def setup(glb):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    w = bpy.data.worlds.new("ambient")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.15, 0.17, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sc.collection.objects.link(sun)
    sun.data.energy = 3.2
    sun.data.angle = math.radians(8)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    cam.data.clip_end = 20000
    return sc, sun, cam


def trim_above(objs, names, keep):
    """Delete the geometry more than `keep` kit units above the group's lowest point (a chandelier's chain)."""
    zmin = min((objs[n].matrix_world @ v.co).z for n in names for v in objs[n].data.vertices)
    for n in names:
        o = objs[n]
        bm = bmesh.new()
        bm.from_mesh(o.data)
        doomed = [v for v in bm.verts if (o.matrix_world @ v.co).z > zmin + keep]
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    bpy.context.view_layer.update()


def region_objects(region, exclude):
    """Mesh objects whose world box centre lies inside region's min / max (kit units), minus `exclude` prefixes."""
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH" or len(o.data.vertices) == 0 or any(o.name.startswith(e) for e in exclude):
            continue
        pts = [o.matrix_world @ v.co for v in o.data.vertices]
        c = [(min(p[i] for p in pts) + max(p[i] for p in pts)) / 2 for i in range(3)]
        if all(region["min"][i] <= c[i] <= region["max"][i] for i in range(3)):
            out.append(o.name)
    return sorted(out)


def render_variant(sc, sun, cam, names, az_deg, flatten, path, keep=None, rot_z=0.0, moves=None, pivot_at=None, sun_side=1):
    objs = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
    for n in names:
        if n not in objs:
            raise SystemExit(f"no mesh object {n!r} in the kit")
    for o in objs.values():
        o.hide_render = o.name not in names
    if keep is not None:
        trim_above(objs, names, keep)
    saved = {}
    # moves, then rot_z: glTF imports nest objects under a converted root, so both work on matrix_world, restored
    # after. rot_z turns the group about its centre in world space (a wall piece facing another wall normal; the camera
    # stays put).
    turned = {}
    for n in names:
        turned[n] = objs[n].matrix_world.copy()
    for n, d in (moves or {}).items():
        if n not in turned:
            raise SystemExit(f"moved object {n!r} is not in the piece")
        objs[n].matrix_world = Matrix.Translation(Vector(d)) @ objs[n].matrix_world
    bpy.context.view_layer.update()
    pts0 = [objs[n].matrix_world @ v.co for n in names for v in objs[n].data.vertices]
    c = Vector(((min(p.x for p in pts0) + max(p.x for p in pts0)) / 2, (min(p.y for p in pts0) + max(p.y for p in pts0)) / 2, 0))
    turn = Matrix.Translation(c) @ Matrix.Rotation(math.radians(rot_z), 4, "Z") @ Matrix.Translation(-c)
    foot = turn @ Vector((pivot_at[0], pivot_at[1], 0)) if pivot_at is not None else None
    if rot_z:
        for n in names:
            objs[n].matrix_world = turn @ objs[n].matrix_world
        bpy.context.view_layer.update()
    # flatten (lying chains): squash the group's height about its lowest point
    if flatten is not None:
        zmin = min((objs[n].matrix_world @ Vector(c)).z for n in names for c in objs[n].bound_box)
        for n in names:
            o = objs[n]
            saved[n] = (o.location.copy(), o.scale.copy())
            o.scale = (o.scale[0], o.scale[1], o.scale[2] * flatten)
            o.location = (o.location[0], o.location[1], zmin + (o.location[2] - zmin) * flatten)
        bpy.context.view_layer.update()
    el = math.radians(PITCH_DEG)
    az = math.radians(az_deg)
    back = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    fwd = -back
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd).normalized()
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = fwd.to_track_quat("-Z", "Y")
    # sun_side 1 (the default, every piece): the sun from the camera's upper left; -1 mirrors it, 0 is frontal
    sd = (back * 0.6 - right * 0.8 + Vector((0, 0, 1.2))).normalized()
    if sun_side != 1:
        sd = (back * 0.6 - right * (0.8 * sun_side) + Vector((0, 0, 1.2))).normalized()
    sun.rotation_mode = "QUATERNION"
    sun.rotation_quaternion = (-sd).to_track_quat("-Z", "Y")
    pts = [objs[n].matrix_world @ v.co for n in names for v in objs[n].data.vertices]
    rs = [p.dot(right) for p in pts]
    us = [p.dot(up) for p in pts]
    fs = [p.dot(fwd) for p in pts]
    pad = 6
    wdt = max(rs) - min(rs) + 2 * pad
    hgt = max(us) - min(us) + 2 * pad
    cam.location = right * ((max(rs) + min(rs)) / 2) + up * ((max(us) + min(us)) / 2) + fwd * (min(fs) - 5000)
    cam.data.ortho_scale = max(wdt, hgt)
    sc.render.resolution_x = max(8, round(wdt * RENDER_PPU))
    sc.render.resolution_y = max(8, round(hgt * RENDER_PPU))
    sc.render.resolution_percentage = 100
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # the footprint's centre on the floor (group box centre, lowest point), in render pixels
    base = Vector(((min(p.x for p in pts) + max(p.x for p in pts)) / 2, (min(p.y for p in pts) + max(p.y for p in pts)) / 2, min(p.z for p in pts)))
    if foot is not None:
        base = Vector((foot.x, foot.y, base.z))
    pivot = ((base.dot(right) - (min(rs) - pad)) * RENDER_PPU, ((max(us) + pad) - base.dot(up)) * RENDER_PPU)
    for n, (loc, scale) in saved.items():
        objs[n].location = loc
        objs[n].scale = scale
    for n, mw in turned.items():
        objs[n].matrix_world = mw
    bpy.context.view_layer.update()
    return pivot


def reduce(path, size_px, fit, grade, units_per_tile=None):
    im = Image.open(path).convert("RGBA")
    a = np.array(im).astype(np.float64) / 255.0
    alpha = a[..., 3:4]
    ys, xs = np.where(alpha[..., 0] > 0.1)
    body_w = xs.max() - xs.min() + 1
    body_h = ys.max() - ys.min() + 1
    if fit == "world":
        k = TILE_PX / (units_per_tile * RENDER_PPU)
    elif fit == "box":
        k = min(size_px[0] / body_w, size_px[1] / body_h)
    else:
        k = size_px / (body_w if fit == "width" else max(body_w, body_h))
    pm = np.concatenate([a[..., :3] * alpha, alpha], axis=2)
    size = (max(1, round(im.width * k)), max(1, round(im.height * k)))
    ch = [Image.fromarray((pm[..., i] * 255).round().astype(np.uint8)).resize(size, Image.LANCZOS) for i in range(4)]
    out = np.stack([np.array(c).astype(np.float64) / 255.0 for c in ch], axis=2)
    al = out[..., 3:4]
    rgb = np.where(al > 0, out[..., :3] / np.maximum(al, 1e-6), 0)
    img = Image.fromarray(np.clip(rgb * 255, 0, 255).round().astype(np.uint8), "RGB")
    if grade is not None:
        img = ImageEnhance.Color(img).enhance(grade["saturation"])
        img = ImageEnhance.Brightness(img).enhance(grade["brightness"])
        img = ImageEnhance.Contrast(img).enhance(grade["contrast"])
        t = np.array(img).astype(np.float64) * np.array(grade["tint"])
        img = Image.fromarray(np.clip(t, 0, 255).round().astype(np.uint8), "RGB")
    res = img.convert("RGBA")
    res.putalpha(Image.fromarray(np.clip(al[..., 0] * 255, 0, 255).round().astype(np.uint8)))
    # 2 px transparent margin all round, so the pipeline's crop never touches the edge
    m = Image.new("RGBA", (res.width + 4, res.height + 4))
    m.paste(res, (2, 2))
    m.save(path)
    return k


def main():
    glb, out, spec_file = sys.argv[1:4]
    spec = json.load(open(spec_file))
    sc, sun, cam = setup(glb)
    for name, piece in spec["pieces"].items():
        os.makedirs(os.path.join(out, name), exist_ok=True)
        turns = piece.get("rotZ", [0] * len(piece["az"]))
        sides = piece.get("sunSide", [1] * len(piece["az"]))
        files = piece.get("files", [f"{name}_{i + 1}.png" for i in range(len(piece["az"]))])
        names = list(piece.get("objects", []))
        if "region" in piece:
            names += [n for n in region_objects(piece["region"], piece.get("exclude", [])) if n not in names]
        for i, az in enumerate(piece["az"]):
            path = os.path.join(out, name, files[i])
            os.makedirs(os.path.dirname(path), exist_ok=True)
            pv = render_variant(sc, sun, cam, names, az, piece.get("flatten"), path, piece.get("keepHeight"), turns[i], piece.get("moves"), piece.get("pivotAt"), sides[i])
            k = reduce(path, piece.get("sizePx"), piece.get("fit", "width"), {**spec["grade"], **piece.get("grade", {})}, piece.get("unitsPerTile"))
            if piece.get("pivotOut"):
                # the floor centre in the written PNG (scaled, 2 px margin): atlases.json's `pivot: [x, y]`
                with open(path + ".pivot.json", "w") as f:
                    json.dump([round(pv[0] * k + 2, 2), round(pv[1] * k + 2, 2)], f)
            print("rendered", path, flush=True)
        # facings a sprite set needs but the game never shows (a wall piece's hidden faces): copies of shown ones
        for dst, src in piece.get("copies", {}).items():
            os.makedirs(os.path.dirname(os.path.join(out, name, dst)), exist_ok=True)
            shutil.copyfile(os.path.join(out, name, src), os.path.join(out, name, dst))
            print("copied", dst, "<-", src, flush=True)


main()
