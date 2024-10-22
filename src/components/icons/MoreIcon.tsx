import { Icon, IconProps } from "@chakra-ui/react";

const More = (props: IconProps) => {
  return (
    <Icon viewBox="0 0 24 24" {...{ strokeWidth: 3, ...props }}>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" />
    </Icon>
  );
};

export default More;
