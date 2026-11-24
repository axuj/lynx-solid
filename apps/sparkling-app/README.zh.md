**中文** | [English](./README.md)

# Solid × Lynx × Sparkling — 一个真正的 App

这不是一个网页 demo，而是一个**能打出 APK、能上真机、有原生路由的 Lynx 应用**，UI 用本仓库的 Solid 运行时写。

```
tailwind.config.ts          ─┐
src/pages/main/index.tsx    ─┤  rspeedy + pluginSolidLynx + Tailwind
src/pages/second/index.tsx  ─┤
                             ▼
                main.lynx.bundle / second.lynx.bundle
                             │  copy-assets
                             ▼
        android/（Sparkling 原生壳）──► app-debug.apk
```

- `android/` —— Sparkling 2.0.1 生成的原生壳：Kotlin、Gradle、LynxView 容器、原生路由、splash。
- `app.config.ts` —— Sparkling 的 App 清单，同时携带我们的 Rspeedy 构建配置（`lynxConfig`）。
- `lynx.config.ts` —— 直接喂给 `rspeedy` 的入口，内容等价于 CLI 在 `.sparkling/` 里临时生成的那份。
- `tailwind.config.ts` —— Lynx Tailwind preset + 这个 App 的颜色 token。
- `scripts/android.mjs` —— 一条命令完成 bundle → 复制资源 → gradle → 安装启动。
- `scripts/copy-assets.mjs` —— 把 `dist/` 复制进 Android 资源目录；只做 Android，不会生成 iOS 目录。

真机验证：Kirin 970 设备上首屏渲染、信号自增、
原生路由打开 `second.lynx.bundle`、`close()` 返回并保留主页面状态，全部正常。

## 为什么这套是“泛用”的

Sparkling 对前端只有两个约定：

1. 原生壳里有一个 LynxView 容器；
2. 容器从 `assets` 里读 `*.lynx.bundle`。

它不关心 bundle 是 ReactLynx、Solid、Vue 还是手写 Lynx 编出来的。`sparkling-app-cli build` 的真实实现只有两步（见 `node_modules/sparkling-app-cli/dist/commands/build.js`）：

```js
await runCommand('rspeedy', ['build', '--config', tempConfig])
await copyAssets({ source: 'dist', androidDest: 'android/app/src/main/assets' })
```

所以**任何能产出 `.lynx.bundle` 的构建都能接进来**。这个示例接的是 `@lynx-solid/plugin`。

Solid 和 ReactLynx 的差异只有一处：

```diff
- pluginReactLynx()
+ pluginSolidLynx()
```

入口从 `root.render(<App />)` 换成 `render(() => <App />)`。路由、scheme、原生 method 全部照旧。

## 样式：Tailwind v3，不是 Web Tailwind

页面用 utility class，`src/App.css` 只保留 `@tailwind` 指令和页面渐变。

- 必须用 Tailwind **v3**：`@tailwindcss/postcss`（v4）和 `rsbuild-plugin-tailwindcss` 冲突。
- `@lynx-js/tailwind-preset` 是实验性的，只覆盖 Lynx 支持的 CSS；没有 hover / focus / media query。
- JIT 靠静态扫描，`bg-${color}` 这种运行时拼出来的类名不会被生成，要写完整字符串或 safelist。
- 迁移成本实测：两个 bundle 各 +2.0 kB（main 91.6 → 93.6 kB，second 88.4 → 90.4 kB）。

## 版本桥（唯一“非标准”的地方）

Sparkling 2.0.1 锁的是 Rspeedy 0.13 / Rsbuild 1.7，而 `@lynx-solid/plugin` 需要 Rsbuild 2。所以 `package.json` 显式声明：

```diff
- "@lynx-js/rspeedy": "^0.13.3"
+ "@lynx-js/rspeedy": "^0.18.5"   // Rsbuild 2.3.2
```

`pluginSolidLynx()` 会检测 `lynx:rsbuild` 插件是否已注册（`isPluginLynxRegistered`），已注册就跳过，不会重复初始化 Lynx 构建引擎。

> 等 Sparkling 官方模板升级到 Rsbuild 2 后，这一行可以删掉。这是版本过渡，不是架构 hack。

## 环境

| 依赖 | 版本 |
|---|---|
| Node | 22 或 24（26 能构建，但 `sparkling doctor` 会报不满足） |
| JDK | 17 |
| Android SDK | platform 34、build-tools 34.0.0、platform-tools |
| adb | 在 PATH 里 |

`ANDROID_HOME` 指向 SDK 根目录（`android-sdk/` 下有 `platforms/`、`build-tools/`、`platform-tools/`）。

构建会通过 `scripts/toolchain.mjs` 解析 `JAVA_HOME` 和 `ANDROID_HOME`：优先 `.env.local`（已 gitignore），
其次环境变量，然后 `android/local.properties` 和常见安装位置。跑 `nub run toolchain` 可以看解析结果；
工具链在别处时，把 `.env.example` 复制成 `.env.local` 填进去即可。`nub run android` 会把同样的结果
应用到子进程，不需要每次手动 export。

### SDK platform 34

装 `platforms;android-34` 这个**基础平台**，不要用 `platforms;android-34-extN` 扩展包：
AGP 7.4 会读平台里 `source.properties` 的 `AndroidVersion.IsBaseSdk`，把扩展包改名成
`android-34` 会报 `Cannot invoke "java.lang.Integer.intValue()" ... mExtensionLevel is null`
或 `Failed to find target with hash string 'android-34'`。

示例还做了两处兼容：

- `android/gradle.properties` 里 `android.builder.sdkDownload=false`：缺组件时立刻报错，
  而不是挂在 `dl.google.com` 上几分钟。
- `android/build.gradle.kts` 把 `buildToolsVersion` 统一钉到 `34.0.0`：AGP 7.4 给没写版本
  的模块（如 `sparkling-navigation`）默认挑 30.0.3，会多下一个并不需要的 build-tools。

## 跑起来

```bash
nub install
nub run build       # 产出 bundle，并复制到 android/app/src/main/assets
nub run android     # gradle assembleDebug；有设备时自动安装并启动
```

产物：

```
android/app/build/outputs/apk/debug/app-debug.apk
```

只想快速看 JS 效果（不动原生）：

```bash
nub run dev         # Rspeedy dev server + 二维码
# 用 Lynx Explorer 扫码 / 粘贴 bundle URL
```

## 冷启动：慢的是 debug 包，不是 Solid

同一台 Kirin 970 设备实测，`adb shell am start -W`，每次
`force-stop` 后冷启动，取 3 次：

| 构建 | `TotalTime` |
|---|---|
| debug（模板默认） | 1149 / 1150 / 1179 ms |
| release（debug 签名，未开 R8） | 388 / 390 / 434 ms |

为了确认这不是 Solid 的锅，用同一份 `android/` 壳 + 官方 ReactLynx 模板的 bundle
（`main` bundle 106 KB，Solid 是 92 KB）做了对照：

| | debug | release |
|---|---|---|
| Solid | ~1.15 s | **~0.40 s** |
| ReactLynx | ~1.30 s | ~0.55 s |

所以白屏时间来自 Sparkling 模板的 debug 构建：Lynx devtool / logbox / debug 引擎全开，
外加没走 R8。Solid 反而比 ReactLynx 略快（bundle 更小，运行时更轻）。

示例针对启动做了三处改动：

1. **`AppLaunchTheme`**（`res/values/styles.xml`）—— 模板原来没有主题，系统启动窗口用的是
   AppCompat 默认白底 + ActionBar，那就是肉眼看到的"白屏 + 标题栏"。现在
   `windowBackground` / 状态栏 / 导航栏都是页面渐变的起始色 `#0F172A`，启动窗口和第一帧同色。
2. **Fresco 后台初始化** —— `Fresco.initialize()` 在主线程要 ~400 ms，而它只服务 `<image>`，
   首帧并不需要。挪到 `fresco-init` 线程后，它和 Lynx 初始化并行，在第一次图片请求前完成。
3. **release 用 debug keystore 签名** —— 只为能在同一台机器上 `installRelease` 做对比，
   **不是发布签名**，上架前必须换成自己的 keystore。

本地跑 release：

```bash
cd android && SPARKLING_USE_NATIVE_ASSETS=true ./gradlew.bat installRelease
```

想看真实冷启动数字：

```bash
adb shell am force-stop com.lynxsolid.demo
adb shell am start -W -n com.lynxsolid.demo/com.example.sparkling.go.SplashActivity
# 看 TotalTime
```

## 开发循环

| 改了什么 | 怎么做 | 反馈速度 |
|---|---|---|
| Solid 页面、样式、逻辑 | `nub run dev` + Lynx Explorer | 秒级 |
| `android/`、原生 method | `nub run android` | 分钟级 |
| 视图树、点击、JS console（debug 包） | `npx agent-lynx snapshot` / `tap` / `get-console` | 秒级 |
| 引擎和原生日志 | `adb logcat -s Lynx` | — |

## 调试

debug 包打开 Lynx 的 devtool、LogBox 和调试引擎，release 包三个都关。这就是上面
冷启动差 ~3 倍的原因，也是“要调试就用 debug 包”的原因。

### 在 App 里

- **LogBox**：JS 报错和 `console.*` 直接画在屏幕上，不会只剩一帧白屏。
- **8901 上的 DevTool**：debug 包会起 Lynx 的 devtool server，用
  [`agent-lynx`](https://www.npmjs.com/package/agent-lynx) 通过 USB 读视图树、驱动 App：

  ```bash
  npx agent-lynx list-clients   # "Solid on Sparkling"，com.lynxsolid.demo
  npx agent-lynx snapshot       # 带 @eN 引用的视图树
  npx agent-lynx tap @e15       # 点 Increment：count 0 -> 1
  npx agent-lynx get-console    # JS console
  npx agent-lynx screenshot -o shot.png
  ```

  等首页布局稳定后再 snapshot：引用里带的是那次快照的 dp 坐标，启动画面/首帧时拍的
  快照会点到别处。如果突然发现不了客户端，先看 `adb forward --list`，把残留的
  `tcp:8901` forward 删掉——`agent-lynx` 直接连设备上的 socket。
- **`adb logcat`** 看 JS 以下的东西：
  `adb logcat -s Lynx LynxDevtool DebugRouter`。

### 原生

用 Android Studio 打开 `android/` 打断点、看布局；`nub run android` 用的是同一个
Gradle 工程。没有 Studio 时，JS/Lynx 侧靠 `adb logcat` 和 `agent-lynx`。

壳里唯一的 debug-only 接线是 `SparklingApplication.initHybridKit` 里那三个
`LynxEnv` 开关，它们必须留在 `HybridKit.initLynxKit()` **之后**——这个调用才会跑
`LynxEnv.init`，在此之前 `enableLynxDebug` 因为没有 context 直接返回，
`setDevtoolEnv` 又被 `isNativeLibraryLoaded()` 挡着。Sparkling 2.0.1 自带的模板写在
前面，那里它们只把标志记下来，什么都不做：不报错，但 8901 不监听，DevTool 也连不上。

## 已知限制

1. **Windows 上的 CLI bug（两处）**：`sparkling-app-cli` 2.0.1 用 `spawn('rspeedy')` 启动构建，Windows 下无法解析 `rspeedy.cmd`；`autolink` 读 `app.config.ts` 时把绝对路径直接丢给 ESM loader，报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。前者由 `scripts/android.mjs` 用 `shell: true` 绕过；后者会回退到默认目录（本示例的目录结构就是默认值，所以结果正确）。
2. **`sparkling doctor` 在这里不可靠**：`java -version` 明明可用，它也会报 JDK 缺失（它只在子进程抛异常时才读 stderr，而 `java -version` 是退出码 0、输出在 stderr）；同时它还不认 Node 26。以 `nub run build` / `nub run android` 为准。
3. **2.0.1 没有 dev server**：app 内从 dev server 加载 bundle 那套（Settings 卡片、
   pipe API、失败回退弹窗）是 2.1 才有的，`sparkling-debug-tool` 从 `2.1.0-rc.2`
   开始发，没有 2.0.x。这里能用的仍是 Debug Panel 和 `agent-lynx`，但 bundle 永远从
   APK 读：改 JS 页面用 `nub run dev` + Lynx Explorer 秒级预览；要让 app 自己加载新
   内容——不管是 JS 还是原生——都得 `nub run android` 重新打包安装。
4. **原生引擎是 Lynx 3.6.0**：我们产出的 bundle `targetSdkVersion` 是 3.2，向后兼容。要换 4.x 引擎需要整体升级 AGP/Kotlin/Gradle，超出示例范围。
5. **JDK toolchain 改成 17**：Sparkling 模板默认强制 JDK 11 toolchain（`android/build.gradle.kts` 里的 `targetJavaVersion` / `jvmToolchain`），示例改成 17，这样只需要装一个 JDK。如果你的环境只能用 JDK 11，把 `targetJavaVersion`、`jvmToolchain`、`sourceCompatibility`、`targetCompatibility`、`jvmTarget` 五处一起改回 11 即可。
6. **APK 体积**：debug 包约 70 MB，因为 `abiFilters` 同时打了 `arm64-v8a` 和 `armeabi-v7a`，且没开 minify。真机验证只留 `arm64-v8a`（改 `android/app/build.gradle.kts` 的 `abiFilters`）可减半；发布用 `assembleRelease` + R8。
7. **只做 Android**：示例只带 Android 壳，`nub run build` 直接写进
   `android/app/src/main/assets`，`autolink` 也带 `--platform android`，不会再生成 iOS 目录。
   需要 iOS 时用 Sparkling 的生成器（`create-sparkling-app` / `sparkling-app-cli`）从同一套模板
   生成即可，`src/pages/**` 本来就是平台无关的——但本示例没有 macOS，没法验证。

## 发布

```bash
keytool -genkeypair -v -keystore release.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias app

# 在 android/app/build.gradle.kts 里配置 signingConfigs，然后：
cd android
gradlew.bat assembleRelease
```

想用 IDE 时，直接用 Android Studio 打开 `android/` 目录（本示例本身不依赖 Studio）。

## 这个例子对别人有什么用

- **想用 Solid 写 Lynx 并上架**：改 `src/pages/**` 就行。
- **想用 Vue/Svelte**：把 `pluginSolidLynx()` 换成对应插件，`scripts/android.mjs` 和 `android/` 原样保留。
- **想看 Sparkling 如何接自定义构建**：读 `scripts/android.mjs` 和 `lynx.config.ts`，它们把 CLI 的黑盒拆开了。
