# pi 的 Bash 工具用 `bash -c` 跑，不加载任何交互式启动文件；cmd.exe 习惯写的
# `cd /d D:/path` 到 bash 里是「内建 cd 收到两个参数」→ bash: cd: too many arguments。
# MSYS/MINGW64 下那个 /d 是 drive-D 挂载点而非 /d 开关，所以丢掉它永远是对的意图。
cd() {
	if [ "$#" -gt 1 ] && [ "$1" = "/d" ]; then
		shift
	fi
	builtin cd "$@"
}
