import { useState } from "react";
import { StudioIcon, type IconName } from "../../components/StudioIcon";
const topics: { title: string; icon: IconName; paragraphs: string[] }[] = [
  {
    title: "总览",
    icon: "info",
    paragraphs: [
      "连接键盘后读取配置。修改保存在本机，确认写入后才会更新键盘。",
      "关闭 Studio 后，后台继续处理已开始的任务。",
    ],
  },
  {
    title: "键盘模式",
    icon: "keyboard",
    paragraphs: [
      "Claude、Cursor、Codex 和 custom 各有一组配置。硬件切换模式时，编辑区自动跟随。",
      "点击模式标签可查看其他配置，不会切换硬件模式。各模式的草稿独立保存。",
    ],
  },
  {
    title: "画布与按键",
    icon: "check",
    paragraphs: [
      "点击按键编辑快捷键或宏，点击灯条调整亮度与描述。",
      "“从设备完整读取”查询键盘，读回后显示键位并保留未写入的修改。“刷新已知键位”读取后台缓存。",
      "写入前会列出修改；结果在任务记录中查看。",
    ],
  },
  {
    title: "LCD 屏幕",
    icon: "screen",
    paragraphs: [
      "支持 PNG、JPEG 和 GIF，文件最大 2 MiB。图片可裁剪到 160 × 80。",
      "GIF 需为 160 × 80、100 毫秒帧间隔、无限循环。各位置的帧数上限见编辑区。",
      "上传覆盖所选位置，可在任务记录中暂停或继续。",
    ],
  },
  {
    title: "任务与恢复",
    icon: "tasks",
    paragraphs: [
      "断线或重开应用后会查询原任务，不会重复提交。",
      "继续暂停任务时会核对设备，跳过已完成的部分；发现冲突时暂停。",
    ],
  },
  {
    title: "权限诊断",
    icon: "settings",
    paragraphs: [
      "在“系统与权限”中查看后台状态，打开 macOS 蓝牙和输入监控权限。",
      "Voice 和审批按键需要后台输入监听；编辑键位和上传画面不需要。开关在重启后台后生效。",
    ],
  },
  {
    title: "语音与审批",
    icon: "microphone",
    paragraphs: [
      "在“语音输入”中授权并选择输入设备。Voice 键需发送 F18，支持按住或点击录音。",
      "在“AI 编程联动”中连接 Codex，再选择手动确认或跟随拨杆。跟随拨杆时，自动档会自动批准收到的工具请求。",
    ],
  },
];
export function HelpPanel() {
  const [selected, setSelected] = useState(0);
  const topic = topics[selected];
  return (
    <div className="help-layout">
      <div className="help-topics" aria-label="帮助主题">
        {topics.map((item, index) => (
          <button
            key={item.title}
            aria-pressed={index === selected}
            onClick={() => setSelected(index)}
          >
            <StudioIcon name={item.icon} />
            {item.title}
          </button>
        ))}
      </div>
      <article className="help-article">
        <h3>{topic.title}</h3>
        {topic.paragraphs.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </article>
    </div>
  );
}
