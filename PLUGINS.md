# 可安装插件

<!--
可安装清单随源码维护，构建时解析为静态列表，内联进主进程与插件设置页；
运行期不读本文件。一行一条来源，远程只接受带 sha256 的 zip，本地路径相对工作区解析：

- [Word 文档](https://github.com/acme/plugin-docx/releases/download/v0.3.1/plugin-docx.zip#sha256=<64位哈希>)
- [表格](https://github.com/acme/plugin-xlsx/releases/download/v0.2.0/plugin-xlsx.zip#sha256=<64位哈希>)
- ./plugins/csv

改完清单后重新构建；开发模式下改动会触发主进程重载（重新打开设置页生效）。
-->
