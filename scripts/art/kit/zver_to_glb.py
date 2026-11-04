"""
Build one .glb from the Dungeon Assets Pack by zver.3d (v1.0.0, FBX + 4k TGA; THIRD_PARTY_NOTICES.md) for
scripts/art/kit/render_kit.py, which renders pieces of ONE .glb (docs/DECOR.md "3D kits"); the reading area's table
and chair (scripts/art/kit/zver-dungeon-assets.json).

Run with Blender's Python module (pip install bpy==5.2.3, Python 3.13), not Node:
  python zver_to_glb.py <pack dir> <out.glb> [texture px, default 1024]
e.g. python zver_to_glb.py ~/Downloads/Models+++Textures+\(FBX+++TGA+4k\) art/vendor/zver-dungeon-assets/zver_dungeon_assets.glb
<pack dir> holds the pack's "Models (FBX)" and "Textures Unreal (TGA 4k)" folders, as downloaded (read only). The FBX
files carry no usable materials, so each object gets a Principled material built from its TGAs: BaseColor, Normal
(Unreal's DirectX convention, its green flipped to Blender's OpenGL one) and the Unreal OcclusionRoughnessMetallic
map's G (roughness) and B (metallic), the channels glTF's metallicRoughness texture uses (R, occlusion, is dropped:
Cycles does not read it). Textures are reduced from 4096 to <texture px> JPEGs, plenty for a sprite a few dozen pixels
across. Every object's transform is applied (and its FBX animation track cleared: the plate's would put the original
scale back) and the set scaled by SCALE (100), so render_kit.py's constants (2 px a unit, 6 units of padding) suit it
as they suit the Sketchfab kits: one FBX unit is 100 glb units (unitsPerTile 220 = 2.2 FBX units a tile). DECIMATE
thins the 596k-vertex fabric stack; RESIZE halves it so it lies on the table as a pile of pages. Objects are named
after their piece (PIECES) and stand centred on the origin, z 0 their lowest point; the kit file's `moves` put the
props on the table top (z 125).
"""
import bpy, os, sys, tempfile
from PIL import Image

SCALE = 100.0
# glb object name: (FBX file, texture folder, texture file prefix)
PIECES = {
    "Table": ("Table.fbx", "Table", "Table"),
    "Chair": ("chair.fbx", "Chair", "chair"),
    "StackOfFabrics": ("Stackoffabrics.fbx", "StackOfFabrics", "Stackoffabrics"),
    "RoundCandlestick": ("Round candlestick.fbx", "RoundCandlestick", "17"),
}
# meshes far denser than a sprite needs (the fabric stack: 596k vertices), reduced (Decimate, collapse ratio)
DECIMATE = {"StackOfFabrics": 0.1}
# props resized to sit on the table as desk things: the fabric stack at about half size reads as a pile of pages
RESIZE = {"StackOfFabrics": 0.55}


def reduced(tga, px, tmp):
    """The TGA as a <px> JPEG in tmp (None when the pack has no such map)."""
    if not os.path.exists(tga):
        return None
    out = os.path.join(tmp, os.path.splitext(os.path.basename(tga))[0] + ".jpg")
    im = Image.open(tga).convert("RGB").resize((px, px), Image.LANCZOS)
    if tga.endswith("_Normal.tga"):
        # DirectX (Unreal) to OpenGL (Blender, glTF): flip green
        r, g, b = im.split()
        im = Image.merge("RGB", (r, g.point(lambda v: 255 - v), b))
    im.save(out, quality=92)
    return out


def material(name, maps):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]

    def tex(path, colour):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(path)
        n.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        return n

    nt.links.new(tex(maps["BaseColor"], True).outputs["Color"], bsdf.inputs["Base Color"])
    if maps.get("Normal"):
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex(maps["Normal"], False).outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if maps.get("OcclusionRoughnessMetallic"):
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex(maps["OcclusionRoughnessMetallic"], False).outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    return mat


def main():
    pack, out = sys.argv[1:3]
    px = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    bpy.ops.wm.read_factory_settings(use_empty=True)
    tmp = tempfile.mkdtemp(prefix="zver_")
    for name, (fbx, folder, prefix) in PIECES.items():
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=os.path.join(pack, "Models (FBX)", fbx))
        new = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in new if o.type == "MESH"]
        if len(meshes) != 1:
            raise SystemExit(f"{fbx}: expected one mesh, got {[o.name for o in new]}")
        for o in new:
            if o.type != "MESH":
                bpy.data.objects.remove(o)
        o = meshes[0]
        o.name = name
        o.data.name = name
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        o.parent = None
        # some FBX files (the plate) carry an animation track that would put the original scale back
        o.animation_data_clear()
        k = SCALE * RESIZE.get(name, 1.0)
        o.scale = [s * k for s in o.scale]
        o.location = [c * k for c in o.location]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if name in DECIMATE:
            mod = o.modifiers.new("decimate", "DECIMATE")
            mod.ratio = DECIMATE[name]
            bpy.ops.object.modifier_apply(modifier=mod.name)
        # stand it at the origin on the floor
        vs = [v.co for v in o.data.vertices]
        cx = (min(v.x for v in vs) + max(v.x for v in vs)) / 2
        cy = (min(v.y for v in vs) + max(v.y for v in vs)) / 2
        z0 = min(v.z for v in vs)
        for v in o.data.vertices:
            v.co.x -= cx
            v.co.y -= cy
            v.co.z -= z0
        o.data.update()
        tdir = os.path.join(pack, "Textures Unreal (TGA 4k)", folder)
        maps = {k: reduced(os.path.join(tdir, f"{prefix}_DefaultMaterial_{k}.tga"), px, tmp) for k in ("BaseColor", "Normal", "OcclusionRoughnessMetallic")}
        o.data.materials.clear()
        o.data.materials.append(material(name, maps))
        print(name, len(o.data.vertices), "verts", "size", [round(d, 1) for d in o.dimensions], "maps", [k for k, v in maps.items() if v], flush=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="AUTO", export_apply=True, export_yup=True, export_animations=False)
    print("wrote", out, os.path.getsize(out), "bytes")


main()
