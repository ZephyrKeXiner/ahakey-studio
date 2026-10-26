import { useState } from "react";
import { StudioIcon, type IconName } from "../../components/StudioIcon";
const topics: { title: string; icon: IconName; paragraphs: string[] }[] = [
  {
    title: "总览",
    icon: "info",
    paragraphs: [
      "Studio 负责编辑与展示，Rust Runtime 负责设备连接和任务执行。关闭 Studio 后，已启动的 Runtime 会继续在后台运行。",
      "先连接键盘，再读取设备配置。修改保存在本机草稿中，只有确认写入后才会改变键盘。",
    ],
  },
  {
    title: "四个 Mode",
    icon: "keyboard",
    paragraphs: [
      "Claude、Cursor、Codex 和 custom 对应四组独立配置。顶部的模式分段按钮选择当前编辑对象，不会直接切换键盘的运行模式。",
      "键盘当前模式可在设备信息中查看。不同模式的草稿分别保存，切换编辑模式不会清除修改。",
    ],
  },
  {
    title: "画布与按键",
    icon: "check",
    paragraphs: [
      "点击画布上的四个按键，在右侧编辑快捷键、修饰键或宏。点击灯条可以调整亮度与按键描述。",
      "“刷新已知键位”查询 Runtime 缓存；“从设备完整读取”重新查询键盘。“同步到编辑区”会先保存可恢复的旧草稿。",
      "写入前会列出实际修改的字段。任务运行时可以继续编辑，新草稿不会被旧任务的完成结果覆盖。",
    ],
  },
  {
    title: "LCD 屏幕",
    icon: "screen",
    paragraphs: [
      "点击画布中的屏幕，选择 PNG、JPEG 或 GIF 素材。静态图片支持缩放和裁剪，目标尺寸为 160 × 80。",
      "素材最大 2 MiB；GIF 需要固定 100 毫秒帧间隔、无限循环，并满足目标位置的帧数限制。画布是位置示意，素材预览显示在右侧。",
      "选择文件后，核对目标位置并确认上传。任务记录支持暂停、查看进度及继续原上传任务。",
    ],
  },
  {
    title: "任务与恢复",
    icon: "tasks",
    paragraphs: [
      "顶部的任务记录保留原任务 ID。断线或重新打开 Studio 后，会查询原任务结果，不会自动重新提交设备写入。",
      "继续暂停的配置任务时，Runtime 先读取设备并核验已完成字段。发现外部修改冲突时会暂停，等待处理。",
    ],
  },
  {
    title: "权限诊断",
    icon: "settings",
    paragraphs: [
      "在“系统与权限”中打开 macOS 蓝牙、输入监控设置。输入监控状态由实际运行的 Runtime 输入组件上报。",
      "编辑配置和上传画面无需开启后台输入观察。观察开关在下次启动 Runtime 时生效，保存开关不会中断当前任务。",
    ],
  },
  {
    title: "语音与灯效",
    icon: "microphone",
    paragraphs: [
      "在语音输入中授予权限，选择 AhaKey 输入设备并启用按键录音。支持按住或点击录音、Apple Speech 实时转写与原生悬浮窗；AhaType 云端整理尚未接入。",
      "AI 编程联动中生成工具 Hook 配置、启用关联键盘，可查看工作状态、批准或拒绝请求。自动批准需勾选允许自动批准且实体拨杆在自动档。灯效状态映射、云端账号和固件升级仍待接入。",
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
        <StudioIcon name={topic.icon} size={30} />
        <h3>{topic.title}</h3>
        {topic.paragraphs.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </article>
    </div>
  );
}
