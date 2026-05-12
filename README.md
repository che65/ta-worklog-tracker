# TA Worklog Tracker

一个基于 React + Vite 的助教工时记录器。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建完成后会生成 `dist` 文件夹。

## Vercel 部署配置

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

## 数据保存说明

本项目目前使用 `localStorage` 保存工时数据。

- 数据保存在用户自己的浏览器中。
- 不同用户之间的数据不会同步。
- 清除浏览器缓存、站点数据或更换浏览器/设备，可能导致数据丢失。
