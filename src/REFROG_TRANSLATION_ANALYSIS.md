# zdftranslatev6 翻译能力对标分析（Read Frog）

基线：`zdf-translate-v2.1.18.zip`（已解包到当前目录）
对标仓库：
- https://github.com/Tabbit-Browser/read-frog
- https://github.com/mengxi-ream/read-frog

---

## 1) 当前结论（只看“翻译功能”）

`mengxi-ream/read-frog` 在翻译链路上明显更完整，核心可借鉴点主要集中在：

1. **翻译请求队列化 + 批处理 + 失败降级**
   - 文件：`src/entrypoints/background/translation-queues.ts`
   - 能力：RequestQueue（限速/容量）+ BatchQueue（按字符数/条数聚合）+ individual fallback。
   - 价值：显著降低 API 次数，稳定性更好，遇到批处理异常可自动回落单条翻译。

2. **缓存键设计更可靠（防止“错缓存”）**
   - 文件：`src/utils/host/translate/translate-text.ts`
   - 能力：hash 组合了 `text + provider + source/target + prompt + AI content aware 上下文`。
   - 价值：不同模型/提示词/上下文不会串缓存，质量更稳定。

3. **上下文感知翻译（AI Content Aware）**
   - 文件：
     - `src/utils/host/translate/translate-text.ts`
     - `src/entrypoints/background/translation-queues.ts`
   - 能力：用 Readability 提取正文；可生成文章 summary 并缓存；把标题/摘要注入 prompt。
   - 价值：术语、代词、上下文连贯性显著提升。

4. **Provider 抽象层（解耦翻译引擎）**
   - 文件：`src/utils/providers/model.ts`
   - 能力：统一 provider 配置（LLM/API）+ providerId 选择。
   - 价值：后续扩展模型和服务更快，减少背景脚本中 if/else 膨胀。

5. **跳过翻译策略更细（避免无效翻译）**
   - 文件：`src/utils/host/translate/translate-text.ts`
   - 能力：目标语言检测、可配置 skip languages，并支持 LLM 检测。
   - 价值：节省 token 和请求，减少“把中文再翻中文”。

6. **页面翻译管理器化（PageTranslationManager）**
   - 文件：`src/entrypoints/host.content/translation-control/page-translation.ts`
   - 能力：将观察器、重翻译、模式切换、状态生命周期组织成可维护结构。
   - 价值：大型网页/动态网页稳定性更高，重构后更易维护。

---

## 2) 对 zdftranslatev6 的最小可行优化（建议优先顺序）

### P0（先做，收益最大）

1. **把 background.js 的翻译请求改为“队列 + 批处理 + fallback”**
   - 先保留现有 provider 调用实现，只重构调度层。
   - 目标：减少速率限制报错、降低 API 成本、提升高并发页面稳定性。

2. **重做缓存 key 结构**
   - 现状多为 `text + lang` 级别；建议加入：
   - `provider/service + model + source/target + promptVersion + textHash`。
   - 目标：避免切换模型后命中旧缓存。

3. **统一翻译入口函数（translateTextCore）**
   - content / selection / youtube 都走一个核心函数。
   - 目标：减少分叉逻辑，后续加策略（如 skip language）只改一处。

### P1（第二阶段）

4. **新增 AI Content Aware（可开关）**
   - 只对 LLM provider 开启。
   - 页面级提取 title + summary，作为 prompt 上下文。

5. **Provider 抽象（providerId + provider config）**
   - 从 `background.js` 巨大 switch 拆分成 provider adapter。
   - 为后续增加服务（openrouter / deepseek / kimi）降低改动成本。

6. **跳过翻译策略**
   - 添加 skip languages（例如 `zh`），避免目标语言重复翻译。

### P2（第三阶段）

7. **PageTranslationManager 化**
   - 管理观察器、DOM 标记、re-translate、模式切换。
   - 解决动态页面、懒加载、切模式后重渲染一致性问题。

---

## 3) 两个 Read Frog 仓库的差异判断

- 两者都可参考，但**mengxi 分支在翻译架构上更完整**（provider 配置、content-aware、summary 缓存、多场景队列复用）。
- `tabbit` 分支更像较早或裁剪版本，翻译核心能力较少。
- 结论：**zdftranslatev6 参考优先级：mengxi > tabbit**。

---

## 4) 可直接落地到 zdftranslatev6 的重构任务清单

1. 新建 `core/translation/queue.js`：RequestQueue + BatchQueue（含 fallback）
2. 新建 `core/translation/hash.js`：统一缓存 key 构建
3. 新建 `core/translation/translate-core.js`：统一翻译入口
4. 新建 `core/providers/*.js`：各 provider adapter
5. 改造 `background.js`：只负责调度与路由，不直写 provider 细节
6. 改造 `content.js`：调用统一入口，补齐模式切换后的重翻译

---

## 5) 风险与注意点

- 批处理需要可靠分隔符与解析，防止模型输出污染分隔符。
- 缓存 key 扩容后，旧缓存可失效（可接受，但需说明）。
- Content Aware 需做超时与回退，避免拖慢首屏。
- 先保证“截图/PDF 悬浮按钮开关”等既有功能不回归（回归清单必须保留）。

---

## 6) 建议实施方式

按 `P0 -> P1 -> P2` 三个小版本推进，每一步都可独立打包验证，避免一次性大改带来回归。