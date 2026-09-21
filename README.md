# 闲值 AI 浏览器插件

闲值 AI 是一个在闲鱼商品详情页使用的 AI 估价助手。它是纯浏览器扩展，不依赖自建后端；商品文字会从当前页面提取，并由扩展直接发送到用户选择的模型服务。
<img width="1910" height="914" alt="估价结果" src="https://github.com/user-attachments/assets/b7aac93b-463a-4fcb-b538-85609f2051a5" />
<img width="1910" height="914" alt="模型配置" src="https://github.com/user-attachments/assets/dd94e2f9-fe64-4e72-ad04-6cd46b413c87" />



## 支持的提供商

- DeepSeek
- 通义千问 Qwen
- 智谱 GLM
- 火山引擎方舟
- 其他 OpenAI Chat Completions 兼容服务

各服务的模型名称、Base URL 与 API Key 都可以独立设置。火山引擎需要填写方舟推理接入点 ID。默认地址来自各提供商官方文档：

- [DeepSeek API 文档](https://api-docs.deepseek.com/zh-cn/)
- [通义千问 OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)
- [智谱开放平台文档](https://docs.bigmodel.cn/)
- [火山引擎方舟文档](https://www.volcengine.com/docs/82379/1494384)

## 安装
Edge应用商店安装：
https://reurl.cc/Vn7nWA
本地编译安装：
1. 解压发布包。
2. Chrome 打开 `chrome://extensions/`；Edge 打开 `edge://extensions/`。
3. 开启“开发者模式”。
4. 选择“加载已解压的扩展程序”，并选择包含 `manifest.json` 的文件夹。
5. 首次安装会自动打开设置页。选择提供商，填写 API Key 和模型名称，然后保存。
6. 打开闲鱼商品详情页，点击页面右下角“闲 AI 估价”，或点击浏览器工具栏中的插件图标。

## 关闭与重新启用

页面侧栏关闭时可选择：

- 本次关闭：仅当前页面会话隐藏，刷新后恢复。
- 当前网站禁用：记录当前闲鱼站点，可在插件菜单或设置页重新启用。
- 永久禁用：全局关闭插件，可从插件菜单右上角开关或设置页重新启用。

## 隐私与权限

- API Key 保存在 `chrome.storage.local`，不会注入网页 DOM。
- 发起估价时，只会把页面中可见的商品标题、价格、描述、属性摘要以及用户主动补充的内容发送给当前选中的模型服务。
- 发送前会尝试隐藏正文中的中国大陆手机号和邮箱地址。
- 插件不会上传商品图片，不会读取聊天记录，也不提供真实成交数据库。
- 自定义兼容服务仅在保存或测试时请求对应域名的访问权限。

提示：扩展本地存储并不是硬件级密钥保险箱。请仅在受信任的个人设备上保存 API Key，并定期轮换密钥。

## 开发验证

```text
npm test
npm run check
```

AI 估价只是参考，不代表实时成交价、真伪鉴定或购买建议。


## 开源协议

本项目采用 [MIT License](LICENSE) 开源。
