import { Box, Heading, Image, Text } from "@chakra-ui/react";
import Sponsor from "#assets/sponsor.png";

export default function BuyMeCoffee() {
  return (
    <Box>
      <Heading fontSize="xl" textAlign="center" mb="1rem" aria-label="Buy Me Coffee">
        {"请一杯咖啡"}
      </Heading>
      <Text as="p" textAlign="center" mb="1rem">
        {"如果您喜欢这个软件，可以考虑请我喝一杯咖啡。"}
      </Text>
      <Image src={Sponsor} alt="Buy Me Coffee" mx="auto" mb="1rem" boxSize="300px" borderRadius="md" />
    </Box>
  );
}
