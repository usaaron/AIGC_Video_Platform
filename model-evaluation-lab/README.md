# 模型能力评测台

独立于 My Comic 正式工作流的四类模型对比模块：总纲、剧情树、单集路线图、正文。四类测试不是流水线，彼此不传递输入或结果。

本目录是自包含服务：不导入正式项目代码、不读取正式项目 `.env.local`、不读取正式项目数据库，也不会修改正式项目的端口或进程。它只使用本目录的 `.env.local` 和 `requirements.txt`。

## 配置

编辑本目录的 `.env.local`，为每个模型填写：

- `LABEL`
- `PROVIDER`
- `MODEL`
- `API_KEY`
- `BASE_URL`
- `WIRE_API`
- `REASONING_EFFORT`
- `THINKING_MODE`
- `TIMEOUT_SECONDS`
- `MAX_RETRIES`
- `MAX_TOKENS`

每类测试固定使用 `MODEL_01` 到 `MODEL_05`，对应 A、B、C、D、E 五个并列槽位。未填写 API Key 的模型会显示为待配置，不参加测试。

每次运行的规则固定为：选择一个测试类型，提供一份公共输入，服务端同时启动该类型下所有已配置模型。每个模型收到完全相同的完整提示词，结果以并列栏展示；没有模型选择或先后调用。

## 启动

```bash
cd model-evaluation-lab
./start.sh
```

默认地址：`http://127.0.0.1:8090`

如果系统没有全局 `uvicorn`，可在本目录单独创建虚拟环境并安装：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
EVALUATION_PYTHON=.venv/bin/python ./start.sh
```

独立运行测试：

```bash
.venv/bin/python -m unittest discover -s tests -v
```

四类测试分别维护输入、附件和结果。服务端不保存测试内容，也不会把一种测试的输出传给另一种测试。API Key 只从服务端环境变量读取，不会通过配置接口返回给浏览器。
