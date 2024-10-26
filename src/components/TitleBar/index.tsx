import { Divider, Flex, IconButton, Menu, MenuButton, MenuItem, MenuList } from "@chakra-ui/react";
import { CloseIcon, MinusIcon } from "@chakra-ui/icons";
import MacOS from "#components/mac";
import MaximumIcon from "#components/icons/MaximumIcon";
import MoreIcon from "../icons/MoreIcon";
import { getCurrentWindow } from "@tauri-apps/api/window";
import packageJson from "~/package.json";
import { useEffect, useRef, useState } from "react";
import UnMaximizeIcon from "../icons/UnMaximizeIcon";
import useDialog from "#/utils/useDialog";
import About, { infoText } from "./About";
import toast from "react-hot-toast";
import PrivacyTip from "./PrivacyTip";
import BuyMeCoffee from "./BuyMeCoffee";
import { fetch } from "@tauri-apps/plugin-http";
import { open } from "@tauri-apps/plugin-shell";
import Update from "./Update";
import compareVersion from "#/utils/compareVersion";
import Cache from "./Cache";
import "./index.css";

type AppWindow = ReturnType<typeof getCurrentWindow>;

const repoURL = "https://github.com/Evanpatchouli/source-codes-trim";
const wikiURL = "https://github.com/Evanpatchouli/source-codes-trim/wiki";
const licenseURL = "https://github.com/Evanpatchouli/source-codes-trim/blob/main/LICENSE";
const issueURL = "https://github.com/Evanpatchouli/source-codes-trim/issues";

export default function TitleBar() {
  const appwindowRef = useRef<AppWindow | null>(null);
  useEffect(() => {
    appwindowRef.current = getCurrentWindow();
  }, []);

  const minimize = () => appwindowRef.current?.minimize();
  const [maximized, setMinimized] = useState(false);
  const handleMaximize = () => {
    appwindowRef.current?.toggleMaximize().then(() => {
      setMinimized((prev) => !prev);
    });
  };
  const exit = () => appwindowRef.current?.close();

  const SponsorDialog = useDialog({
    varient: "primary",
    content: <BuyMeCoffee />,
    canCelProps: {
      hidden: true,
    },
    confirmProps: {
      label: "关闭",
    },
  });

  const PrivacyDialog = useDialog({
    varient: "primary",
    content: <PrivacyTip />,
    canCelProps: {
      hidden: true,
    },
  });

  const CacheDialog = useDialog({
    varient: "primary",
    content: <Cache />,
    canCelProps: {
      hidden: true,
    },
    confirmProps: {
      label: "关闭",
    },
  });

  const [latestVersion, setLatestVersion] = useState("");
  const [latestVersionPublishedAt, setLatestVersionPublishedAt] = useState("");
  const [latestVersionURL, setLatestVersionURL] = useState("");

  const UpdateDialog = useDialog({
    varient: "primary",
    content: <Update v={latestVersion} published_at={latestVersionPublishedAt} />,
    canCelProps: {
      label: "关闭",
    },
    confirmProps: {
      label: "前往下载",
      onClick: () => {
        open(latestVersionURL);
      },
    },
  });

  const InfoDialog = useDialog({
    varient: "primary",
    content: <About />,
    canCelProps: {
      label: "复制",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(infoText);
          toast.success("已复制到剪贴板", {
            position: "bottom-right",
          });
          InfoDialog.close();
        } catch (error) {
          toast.error("复制失败，请手动复制");
        }
      },
    },
  });

  const onClickContributed = () => open(repoURL);
  const onClickWiki = () => open(wikiURL);
  const onClickLicense = () => open(licenseURL);
  const onClickPrivacyTip = () => PrivacyDialog.open();
  const onClickFeedback = () => open(issueURL);
  const onClickSponsor = () => SponsorDialog.open();
  const onClickVisitCache = () => {
    CacheDialog.open();
  };
  const onClickCheckUpdate = async () => {
    const toastId = toast.loading("正在检查更新", {
      position: "bottom-right",
    });
    try {
      const res = await fetch("https://api.github.com/repos/Evanpatchouli/source-codes-trim/releases/latest", {
        headers: {
          "User-Agent": window?.navigator?.userAgent || "SourceCodesTrim",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      const current_version = packageJson.info.version;
      const data = (await res.json()) as ApiGithub.ResponseLatestRelease;
      const latest_version = data.tag_name || current_version;
      setLatestVersion(latest_version);
      setLatestVersionPublishedAt(data.published_at);
      setLatestVersionURL(data.url);
      const shouldUpdate = compareVersion(packageJson.info.version, latest_version) < 0;
      if (shouldUpdate) {
        toast.remove(toastId);
        UpdateDialog.open();
      } else {
        toast.success("已是最新版本", {
          id: toastId,
        });
      }
    } catch (error) {
      toast.remove(toastId);
      console.error(error);
      toast.error("检查更新失败", {
        position: "bottom-right",
      });
    }
  };
  const onClickAbout = () => InfoDialog.open();

  return (
    <header className="header" data-tauri-drag-region>
      <Flex alignItems="center" gap="0.5rem">
        <MacOS.TitleBarDots title={packageJson.info.appname} />
        <Menu>
          <MenuButton className="title-bar-action" id="title-bar-menubtn">
            <MoreIcon color="gray.800" />
          </MenuButton>
          <MenuList>
            <MenuItem aria-label="加入建设" fontSize="sm" onClick={onClickContributed}>
              加入建设
            </MenuItem>
            <Divider />
            <MenuItem aria-label="文档" fontSize="sm" onClick={onClickWiki}>
              文档
            </MenuItem>
            <Divider />
            <MenuItem aria-label="查看许可证" fontSize="sm" onClick={onClickLicense}>
              查看许可证
            </MenuItem>
            <MenuItem aria-label="隐私申明" fontSize="sm" onClick={onClickPrivacyTip}>
              隐私申明
            </MenuItem>
            <Divider />
            <MenuItem aria-label="反馈" fontSize="sm" onClick={onClickFeedback}>
              反馈
            </MenuItem>
            <MenuItem aria-label="赞助作者" fontSize="sm" onClick={onClickSponsor}>
              请一杯咖啡
            </MenuItem>
            <Divider />
            <MenuItem aria-label="查看缓存" fontSize="sm" onClick={onClickVisitCache}>
              查看缓存
            </MenuItem>
            <MenuItem aria-label="检查更新" fontSize="sm" onClick={onClickCheckUpdate}>
              检查更新
            </MenuItem>
            <Divider />
            <MenuItem aria-label="关于" fontSize="sm" onClick={onClickAbout}>
              关于
            </MenuItem>
          </MenuList>
        </Menu>
      </Flex>
      <Flex>
        <IconButton
          aria-label="最小化窗口"
          variant="ghost"
          size="sm"
          color="gray.800"
          className="title-bar-action"
          onClick={minimize}
        >
          <MinusIcon fontSize="smaller" />
        </IconButton>
        <IconButton
          aria-label={maximized ? "还原窗口" : "最大化窗口"}
          variant="ghost"
          size="sm"
          color="gray.800"
          className="title-bar-action"
          onClick={handleMaximize}
        >
          {maximized ? <UnMaximizeIcon fontSize="smaller" /> : <MaximumIcon fontSize="smaller" />}
        </IconButton>
        <IconButton
          aria-label="退出应用"
          variant="ghost"
          size="sm"
          color="gray.800"
          className="title-bar-action"
          onClick={exit}
        >
          <CloseIcon fontSize="smaller" />
        </IconButton>
      </Flex>
      <PrivacyDialog.Render />
      <SponsorDialog.Render />
      <CacheDialog.Render />
      <UpdateDialog.Render />
      <InfoDialog.Render />
    </header>
  );
}
