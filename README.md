# 3D 全链路自动蒙皮 + 绑骨 + 预设动作 + 交互

这是一个可运行的最小可用程序（MVP），支持以下流程：

1. 输入文字 / 图片 / 已有 3D 模型
2. 转成 3D 模型（文字和图片通过 Meshy API，已有模型直接走后处理）
3. 在 Blender 中自动绑骨、自动蒙皮
4. 自动生成预设动作（idle / wave / jump）
5. 导出为可交互的 GLB，并在网页端播放动作

## 目录

- `app/main.py`: FastAPI 服务入口
- `app/input_handlers.py`: 输入源处理（文字/图片/模型）
- `app/blender_worker.py`: Blender 批处理执行器
- `blender_scripts/auto_rig_and_animate.py`: 自动绑骨蒙皮与动画生成脚本
- `web/index.html` + `web/app.js`: 3D 交互查看器

## 环境要求

- Python 3.10+
- Blender 4.x（命令行可调用）
- 可选：Meshy API Key（文本/图片转 3D 时需要）

## 安装

```bash
pip install -r requirements.txt
```

复制配置模板：

```bash
cp .env.example .env
```

Windows 可用：

```powershell
Copy-Item .env.example .env
```

程序启动时会自动读取项目根目录下的 `.env` 文件。

配置项（写在 `.env` 即可）：

- `BLENDER_BIN`: Blender 可执行文件路径，例 `C:\Program Files\Blender Foundation\Blender 4.2\blender.exe`
- `MESHY_API_KEY`: 仅文字/图片转模型时需要
- `MESHY_API_BASE`: 默认 `https://api.meshy.ai/openapi/v1`
- `EXTERNAL_ANIM_DIR`: 外部动作目录，默认 `./external_animations`
- `ENABLE_EXTERNAL_ANIM`: 是否启用外部动作重定向（默认 `false`，推荐先用安全模式）
- `BONE_ALIAS_MAP_PATH`: 骨骼别名映射文件路径，默认 `./external_animations/bone_alias_map.json`

动作策略开关：

- `strict`: 稳定优先，只保留高通过率动作
- `balanced`: 动作丰富优先，放宽可用性阈值，尽量保留更多可交互动作
- 前端可直接切换策略（动作策略下拉框），每次提交时带上策略参数

骨骼绑定与映射：

- 当前自动骨架目标骨为：
  - `root`
  - `spine`
  - `head`
  - `shoulder.L` / `shoulder.R`
  - `upper_arm.L` / `forearm.L`
  - `upper_arm.R` / `forearm.R`
  - `thigh.L` / `shin.L`
  - `thigh.R` / `shin.R`
- 你可以通过 `BONE_ALIAS_MAP_PATH` 指向的 JSON 覆盖外部动作骨骼映射。
- 示例映射文件见：`external_animations/bone_alias_map.example.json`。

动作应用优先级（已实现）：

1. 方案1（优先）：若输入模型本身带 Mixamo 骨架（`mixamorig:*`），外部 FBX 动作优先按同骨架直接应用（质量最佳）。
2. 方案2（回退）：若不是同骨架，则执行当前重定向映射流程。
3. 对无骨骼 Meshy GLB 的自动绑定模式，默认仅输出低变形交互动作（`00_idle_preview` / `idle` / `wave_safe` / `nod`）。

说明：如果 `.env` 里误写成 `https://api.meshy.ai/openapi/v2`，程序会在启动时自动归一化到 `v1`。

外部动作导入（推荐）：

- 将动作文件放入 `EXTERNAL_ANIM_DIR` 指向的目录，支持 `.fbx` / `.glb` / `.gltf` / `.bvh`
- 管线会优先尝试导入并重定向这些外部动作；如果目录为空或导入失败，会自动回退到内置 `idle/wave/jump`
- 推荐使用 Mixamo 导出的动作 FBX（更容易与当前骨骼映射匹配）

尺寸与动作稳定性策略：

- 所有输入模型（文字/图片生成或用户上传）在绑定前会统一做 canonical 尺寸归一化（统一到同一世界尺度）
- 外部动作必须满足核心骨骼映射（头、躯干、四肢关键骨），不满足会被自动跳过
- 导入动作会做可用性检查（形变和尺寸异常过滤），异常动作不会导出到最终交互模型
- 对非完整人形模型（例如仅头像/半身）会自动关闭动态动作并回退为静态待机，避免动作扭曲

建议：

- 默认使用 `ENABLE_EXTERNAL_ANIM=false` 的安全模式（静态预览 + 轻微待机），保证任何模型都可稳定展示
- 只有在确认模型是完整人形并且动作 FBX 与骨架匹配时，再设置 `ENABLE_EXTERNAL_ANIM=true`

## 启动

```bash
uvicorn app.main:app --reload --port 8000
```

## API

### 1) 文字输入

```bash
curl -X POST http://127.0.0.1:8000/pipeline/text \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cartoon robot"}'
```

### 2) 图片输入

```bash
curl -X POST http://127.0.0.1:8000/pipeline/image \
  -F "file=@./demo.png"
```

### 3) 已有模型输入

```bash
curl -X POST http://127.0.0.1:8000/pipeline/model \
  -F "file=@./character.glb"
```

返回示例：

```json
{
  "status": "ok",
  "source": "model",
  "output_model_url": "/models/xxxx_character_interactive.glb",
  "viewer_url": "/web/index.html?model=/models/xxxx_character_interactive.glb",
  "animations": ["idle", "wave", "jump"]
}
```

## 交互方式

- 打开 `viewer_url`
- 点击左侧按钮切换动作
- 点击模型区域会触发一次交互动作并自动回到待机
- 鼠标拖拽/滚轮进行视角控制

## 注意事项

- 自动骨架对无骨骼模型使用稳定 fallback 方案；仅当输入模型本身带 Mixamo 骨架时才走 direct Mixamo 动作链路
- 外部动作会先尝试直接应用；不兼容时会走重定向与质量门控，失败动作会在报告中标记原因
- 默认待机为自然下垂姿态（`00_idle_preview` / `idle`），交互动作结束后回到待机
- 如果文字/图片生成失败，优先检查 `MESHY_API_KEY` 与额度
- 导入非人物模型时，动作表现会受网格结构影响
