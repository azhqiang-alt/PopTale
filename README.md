# PopTale · 萤火绘本

一个给小朋友看的中文 3D 立体绘本阅读器。翻开书，纸片做的场景从书页上立起来，讲述人把故事读给孩子听，读到哪个词，哪个词就亮起来。点一点文字或场景里的角色，它们会跳、会转、会发光。

纯静态网页（Vite + three.js），没有后端。旁白和插画用本地模型离线生成，提交在仓库里。

## 已实现的功能

**书架**
- 书架上有 5 本原创绘本：《乐乐送星星回家》《云朵里的小鲸鱼》《小刺猬的雨伞》《熊猫的新年》《纸船去旅行》
- 选中一本书，它会从书架飞到桌上；再点一下，封面翻开
- 状态为 `soon` 的书会自动生成一张占位封面

**阅读**
- 立体书：每页的右半边是一个纸片场景，背景卡片立起来，角色和物件一层层站在前面，有的悬浮、有的平躺
- 翻页：书页沿弧线弯曲翻过去，旧场景收起，新场景弹出来
- 旁白逐词高亮：音频按词对齐，读到哪个词，那个词就亮
- 词和物件联动：文字里的链接词读到或被点到时，场景里对应的物件会做动作（跳、摇、眨眼、坠落、发光……共 16 种），镜头也会凑近它
- 可以点：点一个词，重播这个词的读音；点场景里的物件，它会做动作并发出声音；点透明的地方不会误触
- 两种读书方式：**听故事**（自动朗读，读完自动翻页）和**自己读**（孩子自己读，读完点"我读完了"）
- 读完一页得一颗星，阅读进度和设置保存在浏览器里
- 设置：自动翻页、大字号、背景音乐、静音

**画面和声音**
- 房间场景：台灯、萤火虫罐子、字母积木、皮球、蜡笔、书本、木头星星，全部用几何体和画布纹理搭出来，没有模型文件；泛光效果只作用在灯泡、萤火虫和发光物件上
- 镜头：按屏幕上文字面板留出的空间自动取景，横屏、竖屏和手机都能用；鼠标或手指移动时有轻微视差
- 声音：八音盒音乐、环境音和各种音效都是 Web Audio 实时合成的，除了旁白没有音频文件

**键盘**

| 按键 | 作用 |
|---|---|
| `→` / `PageDown` | 下一页 |
| `←` / `PageUp` | 上一页 |
| `空格` | 暂停 / 继续朗读（在书架上选中书时：打开书） |
| `Home` | 回到第一页 |
| `M` | 静音 |
| `Esc` | 回书架 |

## 快速开始

需要 Node（版本见 `.nvmrc`，用 nvm 管理）。

```bash
npm install
npm run dev      # 开发服务器，带 --host，同一局域网的手机也能打开
npm run build    # 静态构建到 dist/，base 为 "./"，可部署到任意路径
npm run preview  # 本地预览构建结果
```

构建产物要通过 HTTP 访问，不能直接双击用 `file://` 打开（浏览器会拦截 `fetch` 和模块脚本）。

## 目录结构

```
index.html              页面骨架：文字面板、按钮、设置对话框
src/
  main.js               运行流程：书架 → 选书 → 阅读，翻页、朗读、设置
  stage.js              渲染器、镜头取景、特写、泛光
  props.js              桌上的道具
  shelf.js              书架
  book3d.js             书本几何：封面、书页、翻页动画
  diorama.js            每页的立体场景和动作表 ACTIONS
  narrator.js           旁白播放和逐词时间轴
  reading.js            文字面板：分词显示、高亮、点词
  tokens.js             文本分词（与 build_voice.py 保持一致）
  sound.js              合成音乐与音效
  textures.js           画布纹理、插画加载、剪纸白边
  store.js              localStorage 中的设置与进度
  ui.js / anim.js       界面按钮与补间动画
public/books/
  index.json            书架清单
  <book>/story.json     一本书的全部内容
  <book>/art/           插画（webp）
  <book>/voice/         旁白 mp3 和 timings.json（生成的）
tools/
  build_voice.py        生成旁白和逐词时间轴
  qwen_tts_worker.py    Qwen3-TTS 工作进程（由 build_voice.py 启动）
  gen_art.py            生成插画候选图、抠图、写入书里
  check_book.py         检查书的数据
  placeholder_art.py    生成占位 SVG 插画
```

## 一本书的格式

每本书都是 `public/books/<id>/` 下的一个文件夹，`story.json` 是阅读器和制作工具之间唯一的约定。

```jsonc
{
  "id": "lele-star",
  "title": "乐乐送星星回家",
  "narrator": { "provider": "qwen", "voice": "vivian", "instruct": "用温柔……的语气，给小朋友讲睡前故事" },
  "artStyle": "……所有插画共用的画风描述……",
  "art": {
    "lele": { "file": "art/lele.webp", "kind": "figure", "prompt": "……", "seed": 1042 }
  },
  "pages": [
    {
      "heading": "睡不着的夜晚",
      "text": "夜深了， {小兔乐乐:lele/look} 还 没有 {睡着:lele/yawn}。",
      "hint": "点点乐乐，再点点那颗小星星。",
      "scene": {
        "back": "bg-bedroom",
        "layers": [
          { "name": "lele", "art": "lele", "label": "乐乐", "x": 0.2, "z": 0.34, "width": 0.29, "tap": "hop" },
          { "name": "star", "art": "star", "x": 0.28, "y": 0.57, "z": -0.26, "width": 0.22, "float": true, "tap": "twinkle" }
        ]
      }
    }
  ],
  "end": { "heading": "……", "text": "……", "prompt": "……", "scene": { "...": "结束页的场景" } }
}
```

- **文本**：按空格分词，显示时不显示空格。`{显示文字:物件名/动作}` 把这个词链接到场景里的物件，读到或点到时播放动作。链接里不能有空格。
- **场景**：每个 layer 是一张纸片，坐标在右页空间里：x 从 -0.5 到 0.5，z 从 -0.7（远边）到 0.7，y 向上。可选项有 `float`（悬浮）、`flat`（平躺）、`tap`（点击动作）、`sound`、`glow`。z 最好不超过 0.3 左右，否则镜头会裁到。
- **插画种类**：`scene`（背景卡片，切成拱形）、`figure`（角色或物件，抠图后按轮廓裁切）、`cover`（封面，书名用字体排上去）。

改完 `story.json` 后运行检查：

```bash
python3 tools/check_book.py --all    # 检查链接、物件、动作和插画文件
```

## 制作一本书

目前的流程：先手写 `story.json`，然后生成插画和旁白。全部在本机运行，不需要 API key。

### 1. 插画（默认 Z-Image Turbo，通过 mflux 在 Apple Silicon 上本地运行）

用项目里的 `.venv`（mflux、rembg、pillow）。

```bash
.venv/bin/python tools/gen_art.py --save-model                 # 第一次：保存一份 8-bit 量化模型
.venv/bin/python tools/gen_art.py <book> --todo --count 3      # 为还没选定的插画各生成几张候选
.venv/bin/python tools/gen_art.py <book> lele star --count 4   # 只为指定的插画生成候选
.venv/bin/python tools/gen_art.py <book> --pick lele=1042      # 选定：抠图、裁形、写入 art/，更新 story.json
```

候选图和对比图 `sheet.png` 在 `tools/.cache/art/<book>/<id>/`。

### 2. 旁白（默认 Qwen3-TTS，通过 mlx-audio 离线运行）

需要系统 python3（只用标准库）、PATH 上的 ffmpeg，以及装好 Qwen3-TTS 的 mlx-audio 环境（默认 `~/.venvs/mlx-audio`，可用 `MLX_AUDIO_PYTHON` 指定）。

```bash
python3 tools/build_voice.py <book>                             # 整本书 → public/books/<book>/voice/
python3 tools/build_voice.py <book> --sample 1 --voice serena   # 试听：只生成第 1 页
python3 tools/build_voice.py <book> --provider say              # 用 macOS 系统语音
```

对齐原理：每个句子单独合成，保证语调自然，再用固定停顿拼起来，所以句子边界是精确的。句子里的逗号停顿从音频能量里找出来；短语内部按字数分配时间（中文一字一音节），词边界再吸附到停顿上。整个过程不需要语音识别。生成的片段缓存在 `tools/.cache/voice/`。

### 3. 上架

把书加进 `public/books/index.json`，运行 `check_book.py --all`，再用 `npm run dev` 打开检查。

## 接入其他模型

语音和绘图模型都可以替换，阅读器不受影响，它只读成品文件。

**选用**：在 `story.json` 里指定，也可以在命令行临时覆盖。

```jsonc
"narrator": {
  "provider": "qwen", "voice": "vivian", "instruct": "……",   // 公共设置
  "say": { "voice": "Tingting", "rate": 150 }                 // 某个服务自己的设置，优先于公共设置
},
"painter": { "provider": "zimage", "steps": 9 }                // 不写时默认 zimage
```

```bash
python3 tools/build_voice.py <book> --provider say --set rate=180
.venv/bin/python tools/gen_art.py <book> star --painter openai --set quality=high
```

| | 已有 | 登记表 |
|---|---|---|
| 语音 | `qwen`（本地）、`say`（macOS）、`openai`（未测试） | `tools/build_voice.py` 的 `PROVIDERS` |
| 绘图 | `zimage`（本地）、`openai`（未测试） | `tools/gen_art.py` 的 `PAINTERS` |

**新增一个语音服务**：写一个类，用 `@provider` 登记，提供 `name`、`ext`、`key()` 和 `synth_many(items)`。如果服务能给出每个词的时间戳，再设 `marks = True`，并让 `synth_many` 返回时间戳，这样就不用估算对齐，英文等其他语言也能逐词高亮。

**新增一个绘图模型**：写一个类，用 `@painter` 登记，提供 `name`、`seeded`、`key()` 和 `paint(prompt, width, height, seed)`。尺寸不对的图会自动裁切。不支持 seed 的模型会忽略它，这时候选编号只用来区分候选图。选定插画时，所用的绘图模型会记在该插画的 `painter` 字段里。

两个文件里登记表上方的注释写明了接口细节。

## 路线图

- [x] **一套预置绘本**：5 本原创书，从插画到旁白全部本地生成
- [ ] **用户上传自己的电子书**：读入纯文本或电子书，自动做成立体绘本
- [ ] **用户编写自己的故事集**：在应用里写故事、整理成书

后两项要求一本书能从纯文本全自动生成，流程是：

1. **分页**：把文本切成适合一页的段落，配上页标题和提示语
2. **链接**：找出文字里的角色和物件，链接到场景物件，并选好动作
3. **写插画提示词**：统一画风，为每个角色、物件和场景写描述
4. **绘制**：批量生成插画，自动挑选或由人挑选
5. **配音**：生成旁白和逐词时间轴

第 1–3 步计划交给大语言模型（Claude API 或本地 mlx 模型），第 4–5 步沿用现有的 `gen_art.py` 和 `build_voice.py`。为此，`story.json` 仍然是唯一的约定，`tools/` 下的脚本都不需要人工交互，以后可以由后端任务直接调用。

**其他打算**
- 可调的朗读语速
- 翻页时镜头轻微起伏，封面内页加花纹
- 小问答和收集要素
- 萤火虫改成粒子效果
- 在 iPhone Safari 上测试
- 部署到静态托管，方便分享

## 说明

所有故事、插画、旁白和音效都是原创或本地生成的。本项目借鉴了 StoryComet 的交互方式，没有使用它的任何代码、美术、音频、故事或品牌。
