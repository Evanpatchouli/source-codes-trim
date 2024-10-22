import { Icon, IconProps } from "@chakra-ui/react";

const MaximumIcon = (props: IconProps) => {
  return (
    <Icon viewBox="0 0 24 24" {...{ strokeWidth: 3, ...props }}>
      <rect x="3" y="3" width="18" height="18" stroke="currentColor" fill="none" />
    </Icon>
  );
};

export default MaximumIcon;
