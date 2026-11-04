"""Decimate golden meshes for the hackathon demo display path.

Reads each ml/triposg-mobile/reference/goldens_5/<id>/mesh.glb, applies
MeshLab quadric edge collapse to ~80k faces (vertex colors preserved via
nearest-source transfer through pymeshlab, normals recomputed on export),
and writes <id>/mesh.display.glb. Originals are never modified.

Run with the triposg-spike conda env:
    ~/anaconda3/envs/triposg-spike/bin/python \
        ml/triposg-mobile/reference/decimate_display.py
"""

import json
import os

import numpy as np
import pymeshlab as ml
import trimesh

TARGET_FACES = 80000

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDENS_DIR = os.path.join(HERE, "goldens_5")
MANIFEST = os.path.join(GOLDENS_DIR, "manifest_5.json")


def decimate_one(mesh_id):
    """Decimate one golden mesh; return (faces, verts, bytes)."""
    src = os.path.join(GOLDENS_DIR, mesh_id, "mesh.glb")
    dst = os.path.join(GOLDENS_DIR, mesh_id, "mesh.display.glb")

    ms = ml.MeshSet()
    ms.load_new_mesh(src)
    ms.meshing_decimation_quadric_edge_collapse(
        targetfacenum=TARGET_FACES,
        preservenormal=True,
    )
    m = ms.current_mesh()
    verts = m.vertex_matrix().astype(np.float64)
    faces = m.face_matrix().astype(np.int64)
    colors = (m.vertex_color_matrix() * 255).round().astype(np.uint8)

    tm = trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        vertex_colors=colors,
        process=False,
    )
    glb = tm.export(file_type="glb")
    with open(dst, "wb") as f:
        f.write(glb)

    return len(faces), len(verts), os.path.getsize(dst)


def main():
    """Decimate every golden listed in the manifest."""
    with open(MANIFEST) as f:
        ids = [img["id"] for img in json.load(f)["images"]]
    total = 0
    for mesh_id in ids:
        faces, verts, size = decimate_one(mesh_id)
        total += size
        print(f"{mesh_id}: {faces} faces, {verts} verts, {size} bytes")
    print(f"total display bytes: {total}")


if __name__ == "__main__":
    main()
