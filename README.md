# Vue WX Helper

Vue 和微信小程序组件智能提示扩展。

## 功能

- **组件识别与补全** — 在 Vue 模板和 WXML 中输入 `<` 自动提示已注册的组件
- **组件属性补全** — 在组件标签内提示目标组件的 props / properties
- **Ctrl+Click 跳转** — 点击组件标签名跳转到组件源文件
- **全局组件扫描** — 自动扫描 `components/` 和 `component/` 文件夹中的组件
- **Data/Props/Computed 提示** — Vue 中 `this.` 和模板插值中提示；小程序中 `this.data.` 和 WXML 插值中提示
- **组件标签高亮** — 已注册的组件标签在模板中以绿色显示

## 设置

- `vueWxHelper.componentFolders` — 自定义全局组件扫描的文件夹路径（相对于工作区根目录），默认 `["components", "component"]`

## 更新日志

详见项目中的 `CHANGELOG.md` 文件。
