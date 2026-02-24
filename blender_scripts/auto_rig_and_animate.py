import argparse
import json
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--external-anim-dir", default="")
    parser.add_argument("--enable-external-anim", default="false")
    parser.add_argument("--action-policy", default="strict")
    parser.add_argument("--bone-alias-map", default="")

    args = []
    if "--" in __import__("sys").argv:
        args = __import__("sys").argv[__import__("sys").argv.index("--") + 1 :]
    return parser.parse_args(args)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(model_path: Path) -> None:
    ext = model_path.suffix.lower()
    if ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(model_path))
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(model_path))
    elif ext in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(model_path))
    elif ext == ".stl":
        bpy.ops.wm.stl_import(filepath=str(model_path))
    else:
        raise RuntimeError(f"Unsupported model format: {ext}")


def get_mesh_objects() -> list[bpy.types.Object]:
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def get_armature_objects() -> list[bpy.types.Object]:
    return [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]


def is_mixamo_armature(armature: bpy.types.Object) -> bool:
    if armature.type != "ARMATURE":
        return False
    bone_names = {bone.name for bone in armature.data.bones}
    return "mixamorig:Hips" in bone_names and "mixamorig:Spine" in bone_names


def get_meshes_skinned_to_armature(
    armature: bpy.types.Object,
) -> list[bpy.types.Object]:
    meshes: list[bpy.types.Object] = []
    for mesh in get_mesh_objects():
        arm_mod = next((m for m in mesh.modifiers if m.type == "ARMATURE"), None)
        if arm_mod and arm_mod.object == armature:
            meshes.append(mesh)
            continue
        if mesh.parent == armature and mesh.parent_type == "ARMATURE":
            meshes.append(mesh)
    return meshes


def pick_primary_mesh(meshes: list[bpy.types.Object]) -> bpy.types.Object:
    if not meshes:
        raise RuntimeError("No mesh found for selected armature")
    return max(meshes, key=lambda obj: len(obj.data.vertices))


def pick_best_mixamo_armature(
    armatures: list[bpy.types.Object],
) -> bpy.types.Object | None:
    mixamo_arms = [arm for arm in armatures if is_mixamo_armature(arm)]
    if not mixamo_arms:
        return None

    return max(
        mixamo_arms,
        key=lambda arm: (
            len(get_meshes_skinned_to_armature(arm)),
            len(arm.data.bones),
        ),
    )


def merge_meshes(meshes: list[bpy.types.Object]) -> bpy.types.Object:
    if not meshes:
        raise RuntimeError("No mesh found in model")
    if len(meshes) == 1:
        merged = meshes[0]
        merged.name = "CharacterMesh"
        bpy.ops.object.select_all(action="DESELECT")
        merged.select_set(True)
        bpy.context.view_layer.objects.active = merged
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        return merged

    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = "CharacterMesh"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return merged


def normalize_mesh_scale(mesh: bpy.types.Object, target_extent: float = 1.7) -> None:
    dims = mesh.dimensions
    extents = [
        ("x", float(dims.x)),
        ("y", float(dims.y)),
        ("z", float(dims.z)),
    ]
    major_axis = max(extents, key=lambda item: item[1])[0]

    if major_axis == "x":
        mesh.rotation_euler = (
            mesh.rotation_euler.x,
            mesh.rotation_euler.y + 1.57079632679,
            mesh.rotation_euler.z,
        )
    elif major_axis == "y":
        mesh.rotation_euler = (
            mesh.rotation_euler.x - 1.57079632679,
            mesh.rotation_euler.y,
            mesh.rotation_euler.z,
        )

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    dims = mesh.dimensions
    source_extent = max(float(dims.x), float(dims.y), float(dims.z), 1e-4)
    scale_factor = target_extent / source_extent
    scale_factor = max(0.05, min(scale_factor, 20.0))

    mesh.scale = (
        mesh.scale.x * scale_factor,
        mesh.scale.y * scale_factor,
        mesh.scale.z * scale_factor,
    )

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def align_mesh_to_template_origin(mesh: bpy.types.Object) -> None:
    bbox = [Vector(corner) for corner in mesh.bound_box]
    min_x = min(v.x for v in bbox)
    max_x = max(v.x for v in bbox)
    min_y = min(v.y for v in bbox)
    max_y = max(v.y for v in bbox)
    min_z = min(v.z for v in bbox)

    center_x = (min_x + max_x) * 0.5
    center_y = (min_y + max_y) * 0.5

    mesh.location.x -= center_x
    mesh.location.y -= center_y
    mesh.location.z -= min_z

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def normalize_output_scene_scale(
    mesh: bpy.types.Object,
    rig: bpy.types.Object,
    target_extent: float = 1.15,
) -> None:
    bpy.context.scene.frame_set(1)
    dims = mesh.dimensions
    source_extent = max(float(dims.x), float(dims.y), float(dims.z), 1e-4)
    scale_factor = target_extent / source_extent
    scale_factor = max(0.05, min(scale_factor, 20.0))

    rig.scale = (
        rig.scale.x * scale_factor,
        rig.scale.y * scale_factor,
        rig.scale.z * scale_factor,
    )

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def is_full_body_candidate(mesh: bpy.types.Object) -> bool:
    dims = mesh.dimensions
    x = max(float(dims.x), 1e-4)
    y = max(float(dims.y), 1e-4)
    z = max(float(dims.z), 1e-4)

    footprint = max(x, y)
    if z / footprint < 1.15:
        return False
    if z < 0.9:
        return False

    return True


def create_basic_armature(_mesh: bpy.types.Object) -> bpy.types.Object:
    """保留旧版简化骨架作为备用"""
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = _mesh
    _mesh.select_set(True)

    shoulder_x = 0.16
    arm_mid_x = 0.24
    arm_end_x = 0.28
    hip_x = 0.09

    bpy.ops.object.armature_add(enter_editmode=True, align="WORLD", location=(0, 0, 0))
    armature = bpy.context.object
    armature.name = "CharacterRig"
    bones = armature.data.edit_bones
    root = bones[0]
    root.name = "root"
    root.head = (0, 0, 0)
    root.tail = (0, 0, 0.22)

    spine = bones.new("spine")
    spine.head = root.tail
    spine.tail = (0, 0, 0.82)
    spine.parent = root

    head = bones.new("head")
    head.head = spine.tail
    head.tail = (0, 0, 1.05)
    head.parent = spine

    shoulder_l = bones.new("shoulder.L")
    shoulder_l.head = (0, 0, 0.78)
    shoulder_l.tail = (shoulder_x, 0, 0.78)
    shoulder_l.parent = spine

    shoulder_r = bones.new("shoulder.R")
    shoulder_r.head = (0, 0, 0.78)
    shoulder_r.tail = (-shoulder_x, 0, 0.78)
    shoulder_r.parent = spine

    arm_l = bones.new("upper_arm.L")
    arm_l.head = shoulder_l.tail
    arm_l.tail = (arm_mid_x, 0, 0.56)
    arm_l.parent = shoulder_l

    forearm_l = bones.new("forearm.L")
    forearm_l.head = arm_l.tail
    forearm_l.tail = (arm_end_x, 0, 0.30)
    forearm_l.parent = arm_l

    arm_r = bones.new("upper_arm.R")
    arm_r.head = shoulder_r.tail
    arm_r.tail = (-arm_mid_x, 0, 0.56)
    arm_r.parent = shoulder_r

    forearm_r = bones.new("forearm.R")
    forearm_r.head = arm_r.tail
    forearm_r.tail = (-arm_end_x, 0, 0.30)
    forearm_r.parent = arm_r

    leg_l = bones.new("thigh.L")
    leg_l.head = (hip_x, 0, 0.22)
    leg_l.tail = (hip_x, 0, -0.22)
    leg_l.parent = root

    shin_l = bones.new("shin.L")
    shin_l.head = leg_l.tail
    shin_l.tail = (hip_x, 0, -0.72)
    shin_l.parent = leg_l

    leg_r = bones.new("thigh.R")
    leg_r.head = (-hip_x, 0, 0.22)
    leg_r.tail = (-hip_x, 0, -0.22)
    leg_r.parent = root

    shin_r = bones.new("shin.R")
    shin_r.head = leg_r.tail
    shin_r.tail = (-hip_x, 0, -0.72)
    shin_r.parent = leg_r

    for bone in bones:
        bone.use_deform = True

    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def bind_mesh_to_armature(mesh: bpy.types.Object, armature: bpy.types.Object) -> None:
    def _distance_to_bone_segment(point: Vector, head: Vector, tail: Vector) -> float:
        segment = tail - head
        seg_len_sq = segment.length_squared
        if seg_len_sq <= 1e-10:
            return (point - head).length
        t = max(0.0, min(1.0, (point - head).dot(segment) / seg_len_sq))
        closest = head + segment * t
        return (point - closest).length

    def _select_pair() -> None:
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        armature.select_set(True)
        bpy.context.view_layer.objects.active = armature

    def _ensure_armature_modifier() -> None:
        modifier = next((m for m in mesh.modifiers if m.type == "ARMATURE"), None)
        if modifier is None:
            modifier = mesh.modifiers.new(name="Armature", type="ARMATURE")
        modifier.object = armature

    def _fallback_weights() -> None:
        verts = mesh.data.vertices
        if not verts:
            return

        use_mixamo_names = armature.data.bones.get("mixamorig:Hips") is not None
        target_bone_map: dict[str, str]
        if use_mixamo_names:
            target_bone_map = {
                "root": "mixamorig:Hips",
                "spine": "mixamorig:Spine",
                "head": "mixamorig:Head",
                "shoulder.L": "mixamorig:LeftShoulder",
                "upper_arm.L": "mixamorig:LeftArm",
                "forearm.L": "mixamorig:LeftForeArm",
                "shoulder.R": "mixamorig:RightShoulder",
                "upper_arm.R": "mixamorig:RightArm",
                "forearm.R": "mixamorig:RightForeArm",
                "thigh.L": "mixamorig:LeftUpLeg",
                "shin.L": "mixamorig:LeftLeg",
                "thigh.R": "mixamorig:RightUpLeg",
                "shin.R": "mixamorig:RightLeg",
            }
        else:
            target_bone_map = {
                "root": "root",
                "spine": "spine",
                "head": "head",
                "shoulder.L": "shoulder.L",
                "upper_arm.L": "upper_arm.L",
                "forearm.L": "forearm.L",
                "shoulder.R": "shoulder.R",
                "upper_arm.R": "upper_arm.R",
                "forearm.R": "forearm.R",
                "thigh.L": "thigh.L",
                "shin.L": "shin.L",
                "thigh.R": "thigh.R",
                "shin.R": "shin.R",
            }

        def _group(canonical_name: str) -> bpy.types.VertexGroup:
            actual_name = target_bone_map[canonical_name]
            group = mesh.vertex_groups.get(actual_name)
            if group is None:
                group = mesh.vertex_groups.new(name=actual_name)
            return group

        target_groups: dict[str, bpy.types.VertexGroup] = {
            canonical: _group(canonical) for canonical in target_bone_map
        }

        for group_name in [group.name for group in mesh.vertex_groups]:
            if group_name in {target_bone_map[key] for key in target_bone_map}:
                mesh.vertex_groups.remove(mesh.vertex_groups[group_name])

        target_groups = {canonical: _group(canonical) for canonical in target_bone_map}

        bone_data = []
        for canonical, actual_name in target_bone_map.items():
            bone = armature.data.bones.get(actual_name)
            if bone is None:
                continue
            bone_data.append(
                (
                    canonical,
                    bone.head_local.copy(),
                    bone.tail_local.copy(),
                    target_groups[canonical],
                )
            )

        if not bone_data:
            return

        z_min = min(float(v.co.z) for v in verts)
        z_max = max(float(v.co.z) for v in verts)
        z_span = max(z_max - z_min, 1e-6)

        for vertex in verts:
            entries: list[tuple[str, float]] = []
            point = Vector(vertex.co)
            z_norm = (float(point.z) - z_min) / z_span
            abs_x = abs(float(point.x))

            head_group = target_groups.get("head")
            spine_group = target_groups.get("spine")
            root_group = target_groups.get("root")
            shoulder_l = target_groups.get("shoulder.L")
            shoulder_r = target_groups.get("shoulder.R")
            arm_l = target_groups.get("upper_arm.L")
            arm_r = target_groups.get("upper_arm.R")
            fore_l = target_groups.get("forearm.L")
            fore_r = target_groups.get("forearm.R")
            thigh_l = target_groups.get("thigh.L")
            thigh_r = target_groups.get("thigh.R")
            shin_l = target_groups.get("shin.L")
            shin_r = target_groups.get("shin.R")

            if z_norm >= 0.90:
                if head_group is not None:
                    head_group.add([vertex.index], 0.98, "REPLACE")
                if spine_group is not None:
                    spine_group.add([vertex.index], 0.02, "ADD")
                continue

            if 0.82 <= z_norm < 0.90:
                if head_group is not None:
                    head_group.add([vertex.index], 0.65, "REPLACE")
                if spine_group is not None:
                    spine_group.add([vertex.index], 0.35, "ADD")
                continue

            if 0.68 <= z_norm < 0.82:
                if spine_group is not None:
                    spine_group.add([vertex.index], 0.86, "REPLACE")
                if abs_x > 0.14:
                    if point.x >= 0 and shoulder_l is not None:
                        shoulder_l.add([vertex.index], 0.14, "ADD")
                    elif point.x < 0 and shoulder_r is not None:
                        shoulder_r.add([vertex.index], 0.14, "ADD")
                continue

            if 0.52 <= z_norm < 0.68:
                if abs_x >= 0.18:
                    if point.x >= 0:
                        if arm_l is not None:
                            arm_l.add([vertex.index], 0.72, "REPLACE")
                        if fore_l is not None:
                            fore_l.add([vertex.index], 0.12, "ADD")
                        if spine_group is not None:
                            spine_group.add([vertex.index], 0.16, "ADD")
                    else:
                        if arm_r is not None:
                            arm_r.add([vertex.index], 0.72, "REPLACE")
                        if fore_r is not None:
                            fore_r.add([vertex.index], 0.12, "ADD")
                        if spine_group is not None:
                            spine_group.add([vertex.index], 0.16, "ADD")
                else:
                    if spine_group is not None:
                        spine_group.add([vertex.index], 0.90, "REPLACE")
                    if root_group is not None:
                        root_group.add([vertex.index], 0.10, "ADD")
                continue

            if 0.30 <= z_norm < 0.52:
                if abs_x >= 0.10:
                    if point.x >= 0 and thigh_l is not None:
                        thigh_l.add([vertex.index], 0.78, "REPLACE")
                    elif point.x < 0 and thigh_r is not None:
                        thigh_r.add([vertex.index], 0.78, "REPLACE")
                    if root_group is not None:
                        root_group.add([vertex.index], 0.22, "ADD")
                else:
                    if root_group is not None:
                        root_group.add([vertex.index], 0.90, "REPLACE")
                    if spine_group is not None:
                        spine_group.add([vertex.index], 0.10, "ADD")
                continue

            if z_norm < 0.30:
                if point.x >= 0:
                    if shin_l is not None:
                        shin_l.add([vertex.index], 0.84, "REPLACE")
                    if thigh_l is not None:
                        thigh_l.add([vertex.index], 0.16, "ADD")
                else:
                    if shin_r is not None:
                        shin_r.add([vertex.index], 0.84, "REPLACE")
                    if thigh_r is not None:
                        thigh_r.add([vertex.index], 0.16, "ADD")
                continue

            for name, head, tail, _group_obj in bone_data:
                distance = _distance_to_bone_segment(point, head, tail)
                score = 1.0 / (distance * distance + 1e-5)

                if name.endswith(".L") and point.x < 0:
                    score *= 0.15
                elif name.endswith(".R") and point.x > 0:
                    score *= 0.15

                if z_norm >= 0.82 and name in {
                    "shoulder.L",
                    "upper_arm.L",
                    "forearm.L",
                    "shoulder.R",
                    "upper_arm.R",
                    "forearm.R",
                }:
                    score *= 0.02

                entries.append((name, score))

            entries.sort(key=lambda item: item[1], reverse=True)
            top = entries[:4]
            total = sum(weight for _, weight in top)
            if total <= 1e-10:
                continue

            normalized = [(name, weight / total) for name, weight in top]
            for name, weight in normalized:
                group = mesh.vertex_groups.get(name)
                if group is not None:
                    group.add([vertex.index], float(weight), "REPLACE")

    _select_pair()
    auto_success = False
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        auto_success = len(mesh.vertex_groups) > 0
    except RuntimeError:
        auto_success = False

    if not auto_success:
        _select_pair()
        try:
            bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
        except RuntimeError:
            _select_pair()
            bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)

    _ensure_armature_modifier()
    _fallback_weights()

    mesh.parent = armature
    mesh.parent_type = "ARMATURE"

    if len(mesh.vertex_groups) == 0:
        raise RuntimeError("Binding failed: mesh has no vertex groups after fallback")


def clear_nla_tracks(armature: bpy.types.Object) -> None:
    if armature.animation_data is None:
        armature.animation_data_create()
    tracks = armature.animation_data.nla_tracks
    while len(tracks) > 0:
        tracks.remove(tracks[0])


def _ensure_pose(armature: bpy.types.Object) -> None:
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    for pbone in armature.pose.bones:
        pbone.rotation_mode = "XYZ"


def _insert_pose_key(armature: bpy.types.Object, frame: int) -> None:
    for pbone in armature.pose.bones:
        pbone.keyframe_insert(data_path="location", frame=frame)
        pbone.keyframe_insert(data_path="rotation_euler", frame=frame)


def _insert_bone_keys(
    armature: bpy.types.Object, frame: int, bone_names: list[str]
) -> None:
    for name in bone_names:
        pbone = armature.pose.bones.get(name)
        if pbone is None:
            continue
        pbone.keyframe_insert(data_path="location", frame=frame)
        pbone.keyframe_insert(data_path="rotation_euler", frame=frame)


def _reset_pose(armature: bpy.types.Object) -> None:
    for pbone in armature.pose.bones:
        pbone.location = (0.0, 0.0, 0.0)
        pbone.rotation_mode = "XYZ"
        pbone.rotation_euler = Euler((0.0, 0.0, 0.0), "XYZ")


def _get_pose_bone(
    armature: bpy.types.Object, aliases: list[str]
) -> bpy.types.PoseBone | None:
    for name in aliases:
        bone = armature.pose.bones.get(name)
        if bone is not None:
            return bone
    return None


def _apply_relaxed_arm_layer(armature: bpy.types.Object) -> None:
    shoulder_l = _get_pose_bone(armature, ["shoulder.L", "mixamorig:LeftShoulder"])
    upper_l = _get_pose_bone(armature, ["upper_arm.L", "mixamorig:LeftArm"])
    fore_l = _get_pose_bone(armature, ["forearm.L", "mixamorig:LeftForeArm"])

    shoulder_r = _get_pose_bone(armature, ["shoulder.R", "mixamorig:RightShoulder"])
    upper_r = _get_pose_bone(armature, ["upper_arm.R", "mixamorig:RightArm"])
    fore_r = _get_pose_bone(armature, ["forearm.R", "mixamorig:RightForeArm"])

    if shoulder_l:
        shoulder_l.rotation_euler = Euler((0.0, 0.0, 0.05), "XYZ")
    if upper_l:
        upper_l.rotation_euler = Euler((0.03, 0.0, 0.22), "XYZ")
    if fore_l:
        fore_l.rotation_euler = Euler((-0.03, 0.0, 0.06), "XYZ")

    if shoulder_r:
        shoulder_r.rotation_euler = Euler((0.0, 0.0, -0.05), "XYZ")
    if upper_r:
        upper_r.rotation_euler = Euler((0.03, 0.0, -0.22), "XYZ")
    if fore_r:
        fore_r.rotation_euler = Euler((-0.03, 0.0, -0.06), "XYZ")


def _apply_relaxed_stand_pose(armature: bpy.types.Object) -> None:
    spine = _get_pose_bone(armature, ["spine", "mixamorig:Spine"])
    head = _get_pose_bone(armature, ["head", "mixamorig:Head"])

    if spine:
        spine.rotation_euler = Euler((0.02, 0.0, 0.0), "XYZ")
    if head:
        head.rotation_euler = Euler((-0.01, 0.0, 0.0), "XYZ")

    _apply_relaxed_arm_layer(armature)


def _smooth_action(action: bpy.types.Action) -> None:
    fcurves = getattr(action, "fcurves", None)
    if fcurves is None:
        return

    for fcurve in fcurves:
        for keyframe in fcurve.keyframe_points:
            keyframe.interpolation = "BEZIER"
            keyframe.handle_left_type = "AUTO_CLAMPED"
            keyframe.handle_right_type = "AUTO_CLAMPED"


def _finalize_action(
    armature: bpy.types.Object,
    action: bpy.types.Action,
    end_frame: int,
    start_frame: int = 1,
) -> None:
    action.frame_range = (start_frame, end_frame)
    _smooth_action(action)
    track = armature.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, start_frame, action)
    strip.action_frame_start = start_frame
    strip.action_frame_end = end_frame
    action.use_fake_user = True


TARGET_BONE_ALIASES: dict[str, list[str]] = {
    "root": ["Hips", "mixamorig:Hips", "root", "Root"],
    "spine": ["Spine", "mixamorig:Spine", "spine"],
    "head": ["Head", "mixamorig:Head", "head"],
    "shoulder.L": ["LeftShoulder", "mixamorig:LeftShoulder", "shoulder.L"],
    "upper_arm.L": ["LeftArm", "mixamorig:LeftArm", "upper_arm.L"],
    "forearm.L": ["LeftForeArm", "mixamorig:LeftForeArm", "forearm.L"],
    "shoulder.R": ["RightShoulder", "mixamorig:RightShoulder", "shoulder.R"],
    "upper_arm.R": ["RightArm", "mixamorig:RightArm", "upper_arm.R"],
    "forearm.R": ["RightForeArm", "mixamorig:RightForeArm", "forearm.R"],
    "thigh.L": ["LeftUpLeg", "mixamorig:LeftUpLeg", "thigh.L"],
    "shin.L": ["LeftLeg", "mixamorig:LeftLeg", "shin.L"],
    "thigh.R": ["RightUpLeg", "mixamorig:RightUpLeg", "thigh.R"],
    "shin.R": ["RightLeg", "mixamorig:RightLeg", "shin.R"],
}

CORE_TARGET_BONES: set[str] = {
    "root",
    "spine",
    "head",
    "shoulder.L",
    "upper_arm.L",
    "forearm.L",
    "shoulder.R",
    "upper_arm.R",
    "forearm.R",
    "thigh.L",
    "shin.L",
    "thigh.R",
    "shin.R",
}


def load_bone_alias_map(path: Path | None) -> dict[str, list[str]]:
    alias_map: dict[str, list[str]] = {
        key: list(values) for key, values in TARGET_BONE_ALIASES.items()
    }
    if path is None or not path.exists():
        return alias_map

    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError("bone alias map must be a JSON object")

    normalized: dict[str, list[str]] = {}
    for key, values in data.items():
        if key not in CORE_TARGET_BONES:
            continue
        if not isinstance(values, list):
            continue
        aliases = [str(v).strip() for v in values if str(v).strip()]
        if aliases:
            normalized[key] = aliases

    missing = sorted(CORE_TARGET_BONES.difference(set(normalized.keys())))
    if missing:
        raise RuntimeError(f"bone alias map missing required target bones: {missing}")

    return normalized


def _import_external_file(
    file_path: Path,
) -> tuple[list[bpy.types.Object], list[bpy.types.Action]]:
    pre_objs = set(bpy.data.objects.keys())
    pre_actions = set(bpy.data.actions.keys())

    ext = file_path.suffix.lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(file_path))
    elif ext in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(file_path))
    elif ext == ".bvh":
        bpy.ops.import_anim.bvh(filepath=str(file_path))
    else:
        return [], []

    new_objects = [obj for obj in bpy.data.objects if obj.name not in pre_objs]
    new_actions = [act for act in bpy.data.actions if act.name not in pre_actions]
    return new_objects, new_actions


def _resolve_source_bone(
    source_armature: bpy.types.Object, aliases: list[str]
) -> bpy.types.PoseBone | None:
    source_names = list(source_armature.pose.bones.keys())

    for alias in aliases:
        bone = source_armature.pose.bones.get(alias)
        if bone is not None:
            return bone

    for alias in aliases:
        alias_lower = alias.lower()
        for name in source_names:
            name_lower = name.lower()
            if name_lower.endswith(f":{alias_lower}") or name_lower.endswith(
                f".{alias_lower}"
            ):
                bone = source_armature.pose.bones.get(name)
                if bone is not None:
                    return bone

    for alias in aliases:
        alias_lower = alias.lower()
        for name in source_names:
            if name.lower().endswith(alias_lower):
                bone = source_armature.pose.bones.get(name)
                if bone is not None:
                    return bone

    return None


def _iter_action_fcurves(action: bpy.types.Action):
    legacy_fcurves = getattr(action, "fcurves", None)
    if legacy_fcurves is not None:
        for fcurve in legacy_fcurves:
            yield fcurve
        return

    layers = getattr(action, "layers", None)
    if layers is None:
        return

    for layer in layers:
        strips = getattr(layer, "strips", None)
        if strips is None:
            continue
        for strip in strips:
            channelbags = getattr(strip, "channelbags", None)
            if channelbags is None:
                continue
            for bag in channelbags:
                bag_fcurves = getattr(bag, "fcurves", None)
                if bag_fcurves is None:
                    continue
                for fcurve in bag_fcurves:
                    yield fcurve


def extract_action_bone_names(action: bpy.types.Action) -> set[str]:
    names: set[str] = set()
    for fcurve in _iter_action_fcurves(action):
        data_path = getattr(fcurve, "data_path", "")
        marker = 'pose.bones["'
        if marker not in data_path:
            continue
        tail = data_path.split(marker, 1)[1]
        bone_name = tail.split('"]', 1)[0]
        if bone_name:
            names.add(bone_name)
    return names


def _retarget_action(
    target_armature: bpy.types.Object,
    source_armature: bpy.types.Object,
    source_action: bpy.types.Action,
    action_name: str,
    bone_alias_map: dict[str, list[str]],
) -> bpy.types.Action:
    if target_armature.animation_data is None:
        target_armature.animation_data_create()
    if source_armature.animation_data is None:
        source_armature.animation_data_create()

    source_armature.animation_data.action = source_action
    retarget_action = bpy.data.actions.new(name=action_name)
    target_armature.animation_data.action = retarget_action
    _ensure_pose(target_armature)

    start = int(source_action.frame_range[0])
    end = int(source_action.frame_range[1])
    start = max(start, 1)
    end = max(end, start)

    mapped_bones: list[
        tuple[bpy.types.PoseBone, bpy.types.PoseBone, Matrix, Matrix, str]
    ] = []
    for target_name, aliases in bone_alias_map.items():
        target_aliases = [target_name, *TARGET_BONE_ALIASES.get(target_name, [])]
        target_bone = _resolve_source_bone(target_armature, target_aliases)
        source_bone = _resolve_source_bone(source_armature, aliases)
        if target_bone is None or source_bone is None:
            continue
        source_rest = source_armature.data.bones[source_bone.name].matrix_local.copy()
        target_rest = target_armature.data.bones[target_bone.name].matrix_local.copy()
        mapped_bones.append(
            (target_bone, source_bone, source_rest, target_rest, target_name)
        )

    mapped_names = {entry[4] for entry in mapped_bones}
    if not CORE_TARGET_BONES.issubset(mapped_names):
        bpy.data.actions.remove(retarget_action)
        missing = sorted(CORE_TARGET_BONES.difference(mapped_names))
        raise RuntimeError(
            f"No compatible bones found for external retarget: missing {missing}"
        )

    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        for (
            target_bone,
            source_bone,
            source_rest,
            target_rest,
            target_name,
        ) in mapped_bones:
            source_pose = source_bone.matrix.copy()
            source_delta = source_rest.inverted() @ source_pose
            target_pose = target_rest @ source_delta

            parent_pose = (
                target_bone.parent.matrix.copy()
                if target_bone.parent
                else Matrix.Identity(4)
            )
            target_local = parent_pose.inverted() @ target_pose
            loc, rot, _scale = target_local.decompose()
            rot_euler = rot.to_euler("XYZ")

            if target_name in {"upper_arm.L", "upper_arm.R"}:
                rot_euler.x = max(min(rot_euler.x, 1.2), -1.2)
                rot_euler.y = max(min(rot_euler.y, 0.9), -0.9)
                rot_euler.z = max(min(rot_euler.z, 1.6), -1.6)
            elif target_name in {"shoulder.L", "shoulder.R"}:
                rot_euler.x = max(min(rot_euler.x, 0.8), -0.8)
                rot_euler.y = max(min(rot_euler.y, 0.6), -0.6)
                rot_euler.z = max(min(rot_euler.z, 1.0), -1.0)
            elif target_name in {"forearm.L", "forearm.R"}:
                rot_euler.x = max(min(rot_euler.x, 1.4), -1.4)
                rot_euler.y = max(min(rot_euler.y, 0.6), -0.6)
                rot_euler.z = max(min(rot_euler.z, 1.5), -1.5)
            elif target_name in {"thigh.L", "thigh.R", "shin.L", "shin.R"}:
                rot_euler.x = max(min(rot_euler.x, 1.5), -1.3)
                rot_euler.y = max(min(rot_euler.y, 0.6), -0.6)
                rot_euler.z = max(min(rot_euler.z, 0.6), -0.6)
            elif target_name in {"spine", "head"}:
                rot_euler.x = max(min(rot_euler.x, 0.8), -0.8)
                rot_euler.y = max(min(rot_euler.y, 0.8), -0.8)
                rot_euler.z = max(min(rot_euler.z, 0.8), -0.8)

            if target_name == "root":
                target_bone.location = (0.0, 0.0, 0.0)
                rot_euler.x = 0.0
                rot_euler.y = 0.0
                rot_euler.z = max(min(rot_euler.z, 0.7), -0.7)
            else:
                target_bone.location = (0.0, 0.0, 0.0)
            target_bone.rotation_mode = "XYZ"
            target_bone.rotation_euler = rot_euler
            target_bone.keyframe_insert(data_path="location", frame=frame)
            target_bone.keyframe_insert(data_path="rotation_euler", frame=frame)

    return retarget_action


def _evaluate_mesh_bounds(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_obj = mesh.evaluated_get(depsgraph)
    evaluated_mesh = evaluated_obj.to_mesh()
    try:
        if not evaluated_mesh.vertices:
            return Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.0))

        min_v = Vector((float("inf"), float("inf"), float("inf")))
        max_v = Vector((float("-inf"), float("-inf"), float("-inf")))
        for vertex in evaluated_mesh.vertices:
            co = vertex.co
            min_v.x = min(min_v.x, co.x)
            min_v.y = min(min_v.y, co.y)
            min_v.z = min(min_v.z, co.z)
            max_v.x = max(max_v.x, co.x)
            max_v.y = max(max_v.y, co.y)
            max_v.z = max(max_v.z, co.z)

        size = max_v - min_v
        center = (max_v + min_v) * 0.5
        return size, center
    finally:
        evaluated_obj.to_mesh_clear()


def _normalize_action_policy(action_policy: str) -> str:
    value = (action_policy or "strict").strip().lower()
    return "balanced" if value == "balanced" else "strict"


def is_action_usable(
    target_armature: bpy.types.Object,
    mesh: bpy.types.Object,
    action: bpy.types.Action,
    action_policy: str,
) -> bool:
    if target_armature.animation_data is None:
        target_armature.animation_data_create()

    target_armature.animation_data.action = None
    bpy.context.scene.frame_set(1)
    rest_size, rest_center = _evaluate_mesh_bounds(mesh)
    rest_diag = max(rest_size.length, 1e-4)

    start = max(int(action.frame_range[0]), 1)
    end = max(int(action.frame_range[1]), start)
    sample_frames = sorted(set([start, end, (start + end) // 2, start + 2, end - 2]))

    target_armature.animation_data.action = action
    is_balanced = _normalize_action_policy(action_policy) == "balanced"
    max_diag_ratio = 3.4 if is_balanced else 2.8
    min_diag_ratio = 0.22 if is_balanced else 0.25
    max_shape_ratio = 36.0 if is_balanced else 28.0
    min_upright_ratio = 0.45 if is_balanced else 0.55
    max_center_delta = rest_diag * (1.1 if is_balanced else 0.9)

    for frame in sample_frames:
        bpy.context.scene.frame_set(frame)
        size, center = _evaluate_mesh_bounds(mesh)
        diag = max(size.length, 1e-4)

        if diag > rest_diag * max_diag_ratio or diag < rest_diag * min_diag_ratio:
            return False

        min_dim = max(min(size.x, size.y, size.z), 1e-4)
        max_dim = max(size.x, size.y, size.z)
        if max_dim / min_dim > max_shape_ratio:
            return False

        if size.z < max(size.x, size.y) * min_upright_ratio:
            return False

        if abs(center.z - rest_center.z) > max_center_delta:
            return False

    return True


def load_external_actions(
    target_armature: bpy.types.Object,
    mesh: bpy.types.Object,
    external_dir: Path,
    action_policy: str,
    bone_alias_map: dict[str, list[str]],
    prefer_direct: bool,
) -> tuple[list[bpy.types.Action], list[dict[str, str]]]:
    if not external_dir.exists() or not external_dir.is_dir():
        return [], []

    results: list[bpy.types.Action] = []
    reports: list[dict[str, str]] = []
    files = sorted(
        [
            path
            for path in external_dir.iterdir()
            if path.suffix.lower() in {".fbx", ".glb", ".gltf", ".bvh"}
        ]
    )

    for file_path in files:
        imported_objects, imported_actions = _import_external_file(file_path)
        try:
            armatures = [obj for obj in imported_objects if obj.type == "ARMATURE"]
            if not armatures:
                reports.append(
                    {
                        "action": file_path.stem,
                        "source": "external",
                        "status": "skipped",
                        "reason": "no_armature_in_file",
                    }
                )
                continue

            source_armature = max(armatures, key=lambda obj: len(obj.data.bones))
            source_action = None
            if source_armature.animation_data and source_armature.animation_data.action:
                source_action = source_armature.animation_data.action
            elif imported_actions:
                source_action = imported_actions[0]

            if source_action is None:
                reports.append(
                    {
                        "action": file_path.stem,
                        "source": "external",
                        "status": "skipped",
                        "reason": "no_action_in_file",
                    }
                )
                continue

            action_name = file_path.stem.lower().replace(" ", "_")
            retargeted: bpy.types.Action
            if prefer_direct:
                target_bones = {bone.name for bone in target_armature.data.bones}
                action_bones = extract_action_bone_names(source_action)
                overlap = len(action_bones.intersection(target_bones))
                direct_ok = overlap >= max(6, int(len(action_bones) * 0.75))

                if direct_ok:
                    retargeted = source_action.copy()
                    retargeted.name = action_name
                else:
                    retargeted = _retarget_action(
                        target_armature=target_armature,
                        source_armature=source_armature,
                        source_action=source_action,
                        action_name=action_name,
                        bone_alias_map=bone_alias_map,
                    )
            else:
                retargeted = _retarget_action(
                    target_armature=target_armature,
                    source_armature=source_armature,
                    source_action=source_action,
                    action_name=action_name,
                    bone_alias_map=bone_alias_map,
                )

            if not is_action_usable(target_armature, mesh, retargeted, action_policy):
                if retargeted.name in bpy.data.actions:
                    bpy.data.actions.remove(retargeted)
                print(f"EXTERNAL_ANIM_SKIP {file_path.name}: unusable deformation")
                reports.append(
                    {
                        "action": action_name,
                        "source": "external",
                        "status": "skipped",
                        "reason": "failed_quality_gate",
                    }
                )
                continue

            results.append(retargeted)
            reports.append(
                {
                    "action": action_name,
                    "source": "external",
                    "status": "kept",
                    "reason": "retarget_ok"
                    if not prefer_direct
                    else "direct_or_retarget_ok",
                }
            )
        except Exception as exc:
            print(f"EXTERNAL_ANIM_SKIP {file_path.name}: {exc}")
            reports.append(
                {
                    "action": file_path.stem,
                    "source": "external",
                    "status": "skipped",
                    "reason": f"exception:{type(exc).__name__}",
                }
            )
        finally:
            for obj in imported_objects:
                if obj.name in bpy.data.objects:
                    bpy.data.objects.remove(obj, do_unlink=True)
            for action in imported_actions:
                if action.users == 0 and action.name in bpy.data.actions:
                    bpy.data.actions.remove(action)

    return results, reports


def create_idle_action(armature: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new(name="idle")
    armature.animation_data.action = action
    _ensure_pose(armature)

    _reset_pose(armature)
    root = _get_pose_bone(armature, ["root", "mixamorig:Hips"])
    _apply_relaxed_stand_pose(armature)
    _apply_relaxed_arm_layer(armature)

    _insert_pose_key(armature, 1)

    _apply_relaxed_stand_pose(armature)
    _apply_relaxed_arm_layer(armature)

    if root:
        root.location = (0.0, 0.0, 0.01)
    _insert_pose_key(armature, 20)

    _apply_relaxed_stand_pose(armature)
    _apply_relaxed_arm_layer(armature)
    if root:
        root.location = (0.0, 0.0, -0.008)
    _insert_pose_key(armature, 40)

    _reset_pose(armature)
    _apply_relaxed_stand_pose(armature)
    _apply_relaxed_arm_layer(armature)
    _insert_pose_key(armature, 80)

    _finalize_action(armature, action, 80)
    return action


def create_wave_action(armature: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new(name="wave")
    armature.animation_data.action = action
    _ensure_pose(armature)

    _reset_pose(armature)

    # 使用 _get_pose_bone 支持两种骨骼命名
    upper = _get_pose_bone(armature, ["upper_arm.R", "mixamorig:RightArm"])
    fore = _get_pose_bone(armature, ["forearm.R", "mixamorig:RightForeArm"])
    spine = _get_pose_bone(armature, ["spine", "mixamorig:Spine", "mixamorig:Spine1"])
    head = _get_pose_bone(armature, ["head", "mixamorig:Head"])
    upper_l = _get_pose_bone(armature, ["upper_arm.L", "mixamorig:LeftArm"])
    root = _get_pose_bone(armature, ["root", "mixamorig:Hips"])

    if upper and fore:
        upper.rotation_euler = Euler((0.0, 0.0, 0.0), "XYZ")
        fore.rotation_euler = Euler((0.0, 0.0, 0.0), "XYZ")
    _insert_pose_key(armature, 1)

    if root:
        root.location = (0.0, 0.0, 0.01)
    if spine:
        spine.rotation_euler = Euler((0.02, 0.0, -0.08), "XYZ")
    if head:
        head.rotation_euler = Euler((0.0, 0.0, -0.08), "XYZ")
    if upper_l:
        upper_l.rotation_euler = Euler((0.05, 0.0, 0.1), "XYZ")
    if upper:
        upper.rotation_euler = Euler((0.15, 0.0, -1.15), "XYZ")
    if fore:
        fore.rotation_euler = Euler((0.0, 0.0, -0.3), "XYZ")
    _insert_pose_key(armature, 14)

    if fore:
        fore.rotation_euler = Euler((0.0, 0.0, 0.25), "XYZ")
        fore.keyframe_insert(data_path="location", frame=22)
        fore.keyframe_insert(data_path="rotation_euler", frame=22)

    if fore:
        fore.rotation_euler = Euler((0.0, 0.0, -0.45), "XYZ")
        fore.keyframe_insert(data_path="location", frame=30)
        fore.keyframe_insert(data_path="rotation_euler", frame=30)

    if fore:
        fore.rotation_euler = Euler((0.0, 0.0, 0.25), "XYZ")
        fore.keyframe_insert(data_path="location", frame=38)
        fore.keyframe_insert(data_path="rotation_euler", frame=38)

    if fore:
        fore.rotation_euler = Euler((0.0, 0.0, -0.35), "XYZ")
        fore.keyframe_insert(data_path="location", frame=46)
        fore.keyframe_insert(data_path="rotation_euler", frame=46)

    _reset_pose(armature)
    _insert_pose_key(armature, 64)

    _finalize_action(armature, action, 64)
    return action


def create_wave_safe_action(armature: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new(name="wave_safe")
    armature.animation_data.action = action
    _ensure_pose(armature)
    _reset_pose(armature)
    _apply_relaxed_stand_pose(armature)
    _apply_relaxed_arm_layer(armature)

    # 使用 _get_pose_bone 支持两种骨骼命名
    upper = _get_pose_bone(armature, ["upper_arm.R", "mixamorig:RightArm"])
    fore = _get_pose_bone(armature, ["forearm.R", "mixamorig:RightForeArm"])
    shoulder = _get_pose_bone(armature, ["shoulder.R", "mixamorig:RightShoulder"])
    spine = _get_pose_bone(armature, ["spine", "mixamorig:Spine", "mixamorig:Spine1"])
    root = _get_pose_bone(armature, ["root", "mixamorig:Hips"])

    _insert_pose_key(armature, 1)

    if root:
        root.location = (0.0, 0.0, 0.005)
    if spine:
        spine.rotation_euler = Euler((0.02, 0.0, -0.04), "XYZ")
    if shoulder:
        shoulder.rotation_euler = Euler((0.0, 0.0, -0.2), "XYZ")
    if upper:
        upper.rotation_euler = Euler((0.05, 0.0, -0.55), "XYZ")
    if fore:
        fore.rotation_euler = Euler((0.0, 0.0, -0.15), "XYZ")
    _insert_pose_key(armature, 14)

    if fore:
        fore.rotation_euler = Euler((0.0, 0.0, 0.12), "XYZ")
    # 使用骨骼对象而不是名称字符串
    if fore:
        fore.keyframe_insert(data_path="location", frame=24)
        fore.keyframe_insert(data_path="rotation_euler", frame=24)

    if fore:
        fore.rotation_euler = Euler((0.0, 0.0, -0.2), "XYZ")
    if fore:
        fore.keyframe_insert(data_path="location", frame=34)
        fore.keyframe_insert(data_path="rotation_euler", frame=34)

    _reset_pose(armature)
    _apply_relaxed_stand_pose(armature)
    _apply_relaxed_arm_layer(armature)
    _insert_pose_key(armature, 52)

    _finalize_action(armature, action, 52)
    return action


def create_nod_action(armature: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new(name="nod")
    armature.animation_data.action = action
    _ensure_pose(armature)
    _reset_pose(armature)
    _apply_relaxed_stand_pose(armature)
    _apply_relaxed_arm_layer(armature)

    # 使用 _get_pose_bone 支持两种骨骼命名
    head = _get_pose_bone(armature, ["head", "mixamorig:Head"])
    spine = _get_pose_bone(armature, ["spine", "mixamorig:Spine", "mixamorig:Spine1"])

    _insert_pose_key(armature, 1)

    if spine:
        spine.rotation_euler = Euler((0.03, 0.0, 0.0), "XYZ")
    if head:
        head.rotation_euler = Euler((0.24, 0.0, 0.0), "XYZ")
    _apply_relaxed_arm_layer(armature)
    _insert_pose_key(armature, 12)

    if head:
        head.rotation_euler = Euler((-0.16, 0.0, 0.0), "XYZ")
    _apply_relaxed_arm_layer(armature)
    if head:
        head.keyframe_insert(data_path="location", frame=24)
        head.keyframe_insert(data_path="rotation_euler", frame=24)

    _reset_pose(armature)
    _apply_relaxed_stand_pose(armature)
    _apply_relaxed_arm_layer(armature)
    _insert_pose_key(armature, 38)

    _finalize_action(armature, action, 38)
    return action


def create_jump_action(armature: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new(name="jump")
    armature.animation_data.action = action
    _ensure_pose(armature)

    _reset_pose(armature)

    # 使用 _get_pose_bone 支持两种骨骼命名
    root = _get_pose_bone(armature, ["root", "mixamorig:Hips"])
    thigh_l = _get_pose_bone(armature, ["thigh.L", "mixamorig:LeftUpLeg"])
    thigh_r = _get_pose_bone(armature, ["thigh.R", "mixamorig:RightUpLeg"])
    shin_l = _get_pose_bone(armature, ["shin.L", "mixamorig:LeftLeg"])
    shin_r = _get_pose_bone(armature, ["shin.R", "mixamorig:RightLeg"])
    spine = _get_pose_bone(armature, ["spine", "mixamorig:Spine", "mixamorig:Spine1"])
    arm_l = _get_pose_bone(armature, ["upper_arm.L", "mixamorig:LeftArm"])
    arm_r = _get_pose_bone(armature, ["upper_arm.R", "mixamorig:RightArm"])
    fore_l = _get_pose_bone(armature, ["forearm.L", "mixamorig:LeftForeArm"])
    fore_r = _get_pose_bone(armature, ["forearm.R", "mixamorig:RightForeArm"])
    head = _get_pose_bone(armature, ["head", "mixamorig:Head"])

    if root:
        root.location = (0.0, 0.0, 0.0)
    _insert_pose_key(armature, 1)

    if root:
        root.location = (0.0, 0.0, -0.08)
    if spine:
        spine.rotation_euler = Euler((0.2, 0.0, 0.0), "XYZ")
    if thigh_l:
        thigh_l.rotation_euler = Euler((0.75, 0.0, 0.0), "XYZ")
    if thigh_r:
        thigh_r.rotation_euler = Euler((0.75, 0.0, 0.0), "XYZ")
    if shin_l:
        shin_l.rotation_euler = Euler((-0.65, 0.0, 0.0), "XYZ")
    if shin_r:
        shin_r.rotation_euler = Euler((-0.65, 0.0, 0.0), "XYZ")
    if arm_l:
        arm_l.rotation_euler = Euler((-0.55, 0.0, 0.15), "XYZ")
    if arm_r:
        arm_r.rotation_euler = Euler((-0.55, 0.0, -0.15), "XYZ")
    if fore_l:
        fore_l.rotation_euler = Euler((-0.2, 0.0, 0.0), "XYZ")
    if fore_r:
        fore_r.rotation_euler = Euler((-0.2, 0.0, 0.0), "XYZ")
    _insert_pose_key(armature, 12)

    if root:
        root.location = (0.0, 0.0, 0.28)
    if spine:
        spine.rotation_euler = Euler((-0.18, 0.0, 0.0), "XYZ")
    if head:
        head.rotation_euler = Euler((-0.08, 0.0, 0.0), "XYZ")
    if thigh_l:
        thigh_l.rotation_euler = Euler((-0.25, 0.0, 0.0), "XYZ")
    if thigh_r:
        thigh_r.rotation_euler = Euler((-0.25, 0.0, 0.0), "XYZ")
    if shin_l:
        shin_l.rotation_euler = Euler((0.15, 0.0, 0.0), "XYZ")
    if shin_r:
        shin_r.rotation_euler = Euler((0.15, 0.0, 0.0), "XYZ")
    if arm_l:
        arm_l.rotation_euler = Euler((0.45, 0.0, 0.2), "XYZ")
    if arm_r:
        arm_r.rotation_euler = Euler((0.45, 0.0, -0.2), "XYZ")
    if fore_l:
        fore_l.rotation_euler = Euler((0.2, 0.0, 0.0), "XYZ")
    if fore_r:
        fore_r.rotation_euler = Euler((0.2, 0.0, 0.0), "XYZ")
    _insert_pose_key(armature, 24)

    if root:
        root.location = (0.0, 0.0, 0.02)
    if spine:
        spine.rotation_euler = Euler((0.08, 0.0, 0.0), "XYZ")
    if thigh_l:
        thigh_l.rotation_euler = Euler((0.35, 0.0, 0.0), "XYZ")
    if thigh_r:
        thigh_r.rotation_euler = Euler((0.35, 0.0, 0.0), "XYZ")
    if shin_l:
        shin_l.rotation_euler = Euler((-0.2, 0.0, 0.0), "XYZ")
    if shin_r:
        shin_r.rotation_euler = Euler((-0.2, 0.0, 0.0), "XYZ")
    if arm_l:
        arm_l.rotation_euler = Euler((-0.25, 0.0, 0.12), "XYZ")
    if arm_r:
        arm_r.rotation_euler = Euler((-0.25, 0.0, -0.12), "XYZ")
    _insert_pose_key(armature, 40)

    _reset_pose(armature)
    _insert_pose_key(armature, 70)

    _finalize_action(armature, action, 70)
    return action


def create_static_idle_action(armature: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new(name="00_idle_preview")
    armature.animation_data.action = action
    _ensure_pose(armature)
    _reset_pose(armature)

    _apply_relaxed_stand_pose(armature)

    _insert_pose_key(armature, 1)
    _insert_pose_key(armature, 20)
    return action


def create_preview_from_action(
    armature: bpy.types.Object, source_action: bpy.types.Action
) -> bpy.types.Action:
    preview = bpy.data.actions.new(name="00_idle_preview")
    armature.animation_data.action = source_action
    _ensure_pose(armature)
    frame = int(max(source_action.frame_range[0], 1))
    bpy.context.scene.frame_set(frame)

    armature.animation_data.action = preview
    _insert_pose_key(armature, 1)
    _insert_pose_key(armature, 20)
    return preview


def export_glb(out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_skins=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_anim_single_armature=True,
        export_yup=True,
    )


def save_manifest(
    manifest: Path,
    animations: list[str],
    action_report: list[dict[str, str]],
    active_bone_alias_map: dict[str, list[str]],
    rig_mode: str,
) -> None:
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(
        json.dumps(
            {
                "animations": animations,
                "action_report": action_report,
                "rig_bones": [
                    "root",
                    "spine",
                    "head",
                    "shoulder.L",
                    "upper_arm.L",
                    "forearm.L",
                    "shoulder.R",
                    "upper_arm.R",
                    "forearm.R",
                    "thigh.L",
                    "shin.L",
                    "thigh.R",
                    "shin.R",
                ],
                "bone_alias_map": active_bone_alias_map,
                "rig_mode": rig_mode,
            },
            ensure_ascii=True,
            indent=2,
        ),
        encoding="utf-8",
    )


def cleanup_actions(keep_names: set[str]) -> None:
    for action in list(bpy.data.actions):
        if action.name in keep_names:
            continue
        if action.users == 0:
            bpy.data.actions.remove(action)


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    manifest_path = Path(args.manifest)
    external_anim_dir = (
        Path(args.external_anim_dir) if args.external_anim_dir else Path("")
    )
    bone_alias_map_path = Path(args.bone_alias_map) if args.bone_alias_map else Path("")
    enable_external_anim = str(args.enable_external_anim).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    action_policy = _normalize_action_policy(args.action_policy)
    active_bone_alias_map = load_bone_alias_map(bone_alias_map_path)

    clear_scene()
    import_model(input_path)

    imported_armatures = get_armature_objects()
    source_mixamo_rig = pick_best_mixamo_armature(imported_armatures)

    if source_mixamo_rig is not None:
        rig = source_mixamo_rig
        skinned_meshes = get_meshes_skinned_to_armature(rig)
        mesh = pick_primary_mesh(
            skinned_meshes if skinned_meshes else get_mesh_objects()
        )
        full_body_candidate = is_full_body_candidate(mesh)
        normalize_mesh_scale(mesh)
        direct_mixamo_mode = True
    else:
        mesh = merge_meshes(get_mesh_objects())
        full_body_candidate = is_full_body_candidate(mesh)
        normalize_mesh_scale(mesh)
        align_mesh_to_template_origin(mesh)

        rig = create_basic_armature(mesh)

        bind_mesh_to_armature(mesh, rig)
        direct_mixamo_mode = False

    clear_nla_tracks(rig)

    animation_names: list[str] = []
    action_report: list[dict[str, str]] = []
    candidate_actions: list[tuple[bpy.types.Action, str]] = []
    external_actions: list[bpy.types.Action] = []
    external_reports: list[dict[str, str]] = []

    if enable_external_anim and direct_mixamo_mode:
        external_actions, external_reports = load_external_actions(
            rig,
            mesh,
            external_anim_dir,
            action_policy,
            active_bone_alias_map,
            prefer_direct=True,
        )
        action_report.extend(external_reports)
    elif enable_external_anim and not direct_mixamo_mode and external_anim_dir.exists():
        for path in sorted(external_anim_dir.iterdir()):
            if path.suffix.lower() not in {".fbx", ".glb", ".gltf", ".bvh"}:
                continue
            action_report.append(
                {
                    "action": path.stem,
                    "source": "external",
                    "status": "skipped",
                    "reason": "requires_mixamo_direct_model",
                }
            )

    action_report.append(
        {
            "action": "pipeline_mode",
            "source": "system",
            "status": "kept",
            "reason": "mixamo_direct" if direct_mixamo_mode else "auto_rig_fallback",
        }
    )

    builtin_full_body_actions: list[bpy.types.Action] = [
        create_wave_safe_action(rig),
        create_nod_action(rig),
    ]

    if external_actions:
        preview_action = create_static_idle_action(rig)
        candidate_actions = [
            (preview_action, "builtin"),
            *[(act, "external") for act in external_actions],
            (create_idle_action(rig), "builtin"),
        ]
    else:
        candidate_actions = [
            (create_static_idle_action(rig), "builtin"),
            (create_idle_action(rig), "builtin"),
            *[(act, "builtin") for act in builtin_full_body_actions],
        ]

    clear_nla_tracks(rig)
    accepted_action_keys: set[str] = set()
    for action, action_source in candidate_actions:
        action_key = action.name.split(".")[0].lower()
        if action_key in accepted_action_keys:
            continue

        is_fallback_safe = action.name in {
            "00_idle_preview",
            "idle",
            "wave_safe",
            "nod",
        }
        if not is_fallback_safe and not is_action_usable(
            rig, mesh, action, action_policy
        ):
            print(f"ANIM_SKIP {action.name}: usability check failed")
            action_report.append(
                {
                    "action": action.name,
                    "source": action_source,
                    "status": "skipped",
                    "reason": "failed_quality_gate",
                }
            )
            continue
        start = int(action.frame_range[0])
        end = int(action.frame_range[1])
        _finalize_action(
            rig, action, end_frame=max(end, start), start_frame=max(start, 1)
        )
        accepted_action_keys.add(action_key)
        animation_names.append(action.name)

        already_reported_external = any(
            item.get("action") == action.name
            and item.get("source") == "external"
            and item.get("status") == "kept"
            for item in action_report
        )
        if action_source == "external" and already_reported_external:
            continue

        action_report.append(
            {
                "action": action.name,
                "source": action_source,
                "status": "kept",
                "reason": "accepted",
            }
        )

    if not animation_names:
        fallback_action = create_static_idle_action(rig)
        _finalize_action(rig, fallback_action, end_frame=20, start_frame=1)
        animation_names = ["idle_static"]
        action_report.append(
            {
                "action": "idle_static",
                "source": "builtin",
                "status": "kept",
                "reason": "final_fallback",
            }
        )

    cleanup_actions(set(animation_names))

    if rig.name in bpy.data.objects:
        for obj in bpy.context.scene.objects:
            obj.select_set(False)
        bpy.context.view_layer.objects.active = rig
        rig.select_set(True)
        if bpy.context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")

    normalize_output_scene_scale(mesh, rig)

    export_glb(output_path)
    save_manifest(
        manifest_path,
        animation_names,
        action_report,
        active_bone_alias_map,
        "mixamo_direct" if direct_mixamo_mode else "auto_rig",
    )


if __name__ == "__main__":
    main()
