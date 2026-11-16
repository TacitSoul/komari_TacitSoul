import { memo, useState } from "react";

interface OsConfig {
  name: string;
  image: string;
  keywords: string[];
}

const OS_NAME_SPLIT_REGEX = /[\s/]+/;

const OS_CONFIGS: OsConfig[] = [
  {
    name: "AlmaLinux",
    image: "/assets/os/os-alma.svg",
    keywords: ["alma", "almalinux"],
  },
  {
    name: "Alpine Linux",
    image: "/assets/os/os-alpine.webp",
    keywords: ["alpine", "alpine linux"],
  },
  {
    name: "Armbian",
    image: "/assets/os/os-armbian.svg",
    keywords: ["armbian"],
  },
  {
    name: "CentOS",
    image: "/assets/os/os-centos.svg",
    keywords: ["centos", "cent os"],
  },
  {
    name: "Debian",
    image: "/assets/os/os-debian.svg",
    keywords: ["debian", "deb"],
  },
  {
    name: "FreeBSD",
    image: "/assets/os/os-freebsd.svg",
    keywords: ["freebsd", "bsd"],
  },
  {
    name: "Ubuntu",
    image: "/assets/os/os-ubuntu.svg",
    keywords: ["ubuntu", "elementary"],
  },
  {
    name: "Windows",
    image: "/assets/os/os-windows.svg",
    keywords: ["windows", "win", "microsoft", "ms"],
  },
  {
    name: "Arch Linux",
    image: "/assets/os/os-arch.svg",
    keywords: ["arch", "archlinux", "arch linux"],
  },
  {
    name: "Kali Linux",
    image: "/assets/os/os-kail.svg",
    keywords: ["kail", "kali", "kali linux"],
  },
  {
    name: "iStoreOS",
    image: "/assets/os/os-istore.png",
    keywords: ["istore", "istoreos", "istore os"],
  },
  {
    name: "OpenWrt",
    image: "/assets/os/os-openwrt.svg",
    keywords: ["openwrt", "open wrt", "open-wrt", "qwrt"],
  },
  {
    name: "ImmortalWrt",
    image: "/assets/os/os-openwrt.svg",
    keywords: ["immortalwrt", "immortal", "emmortal"],
  },
  {
    name: "NixOS",
    image: "/assets/os/os-nix.svg",
    keywords: ["nixos", "nix os", "nix"],
  },
  {
    name: "Rocky Linux",
    image: "/assets/os/os-rocky.svg",
    keywords: ["rocky", "rocky linux"],
  },
  {
    name: "Fedora",
    image: "/assets/os/os-fedora.svg",
    keywords: ["fedora"],
  },
  {
    name: "openSUSE",
    image: "/assets/os/os-openSUSE.svg",
    keywords: ["opensuse", "suse"],
  },
  {
    name: "Gentoo",
    image: "/assets/os/os-gentoo.svg",
    keywords: ["gentoo"],
  },
  {
    name: "Red Hat",
    image: "/assets/os/os-redhat.svg",
    keywords: ["redhat", "rhel", "red hat"],
  },
  {
    name: "Linux Mint",
    image: "/assets/os/os-mint.svg",
    keywords: ["mint", "linux mint"],
  },
  {
    name: "Manjaro",
    image: "/assets/os/os-manjaro-.svg",
    keywords: ["manjaro"],
  },
  {
    name: "Synology DSM",
    image: "/assets/os/os-synology.ico",
    keywords: ["synology", "dsm", "synology dsm"],
  },
  {
    name: "fnOS",
    image: "/assets/os/os-fnos.ico",
    keywords: ["fnos", "fnnas"],
  },
  {
    name: "Proxmox VE",
    image: "/assets/os/os-proxmox.ico",
    keywords: ["proxmox", "proxmox ve"],
  },
  {
    name: "macOS",
    image: "/assets/os/os-macos.svg",
    keywords: ["macos", "mac os", "mac os x", "osx", "darwin"],
  },
  {
    name: "QTS",
    image: "/assets/os/os-qnap.svg",
    keywords: ["qts", "quts hero", "qes", "qutscloud"],
  },
  {
    name: "Astra Linux",
    image: "/assets/os/os-astar.png",
    keywords: ["astra", "astra linux"],
  },
  {
    name: "Orange Pi",
    image: "/assets/os/os-orange-pi.svg",
    keywords: ["orange pi", "orangepi"],
  },
  {
    name: "Huawei",
    image: "/assets/os/os-huawei.svg",
    keywords: ["huawei", "euleros", "euler os"],
  },
  {
    name: "Aliyun",
    image: "/assets/os/alibabacloud-color.svg",
    keywords: ["aliyun", "alibaba"],
  },
  {
    name: "OpenCloudOS",
    image: "/assets/os/os-OpenCloudOS.png",
    keywords: ["opencloud"],
  },
  {
    name: "Unraid",
    image: "/assets/os/os-unraid.svg",
    keywords: ["unraid"],
  },
];

const DEFAULT_OS_CONFIG: OsConfig = {
  name: "Linux",
  image: "/assets/os/linux.svg",
  keywords: ["unknown"],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const OS_MATCHERS = OS_CONFIGS.map((config) => ({
  config,
  matcher: new RegExp(`\\b(?:${config.keywords.map(escapeRegExp).join("|")})\\b`),
}));

function findOsConfig(osString?: string | null): OsConfig {
  if (!osString) {
    return DEFAULT_OS_CONFIG;
  }

  const normalizedInput = osString.toLowerCase().trim();
  for (const { config, matcher } of OS_MATCHERS) {
    if (matcher.test(normalizedInput)) {
      return config;
    }
  }

  return DEFAULT_OS_CONFIG;
}

export function resolveOsInfo(value?: string | null) {
  const config = findOsConfig(value);
  if (config !== DEFAULT_OS_CONFIG) {
    return config;
  }

  const name = value?.trim().split(OS_NAME_SPLIT_REGEX)[0] || DEFAULT_OS_CONFIG.name;
  return {
    ...DEFAULT_OS_CONFIG,
    name,
  };
}

export const OsLogo = memo(function OsLogo({
  value,
  size = 18,
}: {
  value?: string | null;
  size?: number;
}) {
  const os = resolveOsInfo(value);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const src = failedImage === os.image ? DEFAULT_OS_CONFIG.image : os.image;

  return (
    <img
      className="os-logo"
      src={src}
      alt={os.name}
      title={os.name}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      onError={() => {
        if (src !== DEFAULT_OS_CONFIG.image) setFailedImage(os.image);
      }}
      style={{ "--ts-os-logo-size": `${size}px` } as React.CSSProperties}
    />
  );
});
