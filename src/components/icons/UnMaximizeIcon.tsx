import { Icon, IconProps } from "@chakra-ui/react";

const UnMaximizeIcon = (props: IconProps) => {
  return (
    <Icon viewBox="0 0 24 24" {...{ strokeWidth: 2, ...props }}>
      <rect x="3" y="3" width="18" height="18" stroke="currentColor" fill="none" />
      <rect x="7" y="7" width="10" height="10" stroke="currentColor" fill="none" />
    </Icon>
  );
};

export default UnMaximizeIcon;
