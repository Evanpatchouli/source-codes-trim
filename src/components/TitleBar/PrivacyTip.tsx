import { Box, Heading, Link, Text } from "@chakra-ui/react";
import { open } from "@tauri-apps/plugin-shell";
import packageJson from "~/package.json";

export default function PrivacyTip() {
  return (
    <Box>
      <Heading fontSize="xl" textAlign="center" mb="1rem" aria-label="隐私声明">
        {"隐私声明"}
      </Heading>
      <Text mb="1rem">本软件不会收集您的任何隐私信息。我们尊重并保护所有用户的隐私权。</Text>
      <Text mb="1rem">由于本软件不收集任何个人隐私信息，因此不存在对信息的使用、共享或披露。</Text>
      <Text mb="1rem">
        我们致力于保护您的信息安全。尽管我们不收集任何个人隐私信息，但我们仍然采取了必要的措施来确保您的数据在使用本软件时的安全性。
      </Text>
      <Text mb="1rem">本软件不使用任何第三方服务来收集或处理您的个人隐私信息。</Text>
      <Text mb="1rem">您有权随时了解本软件的隐私政策，并对其进行咨询。如果您有任何疑问或建议，请随时联系我们。</Text>
      <Text mb="1rem">
        我们可能会不时更新本隐私声明。任何更新将会在本页面上发布。我们建议您定期查看官网隐私声明，以了解我们如何保护您的隐私。
      </Text>
      <Text mb="1rem">如果您对本隐私声明有任何疑问或建议，请通过以下方式联系我们：</Text>
      <Text mb="1rem">
        电子邮件：
        <Link
          aria-label="电子邮件"
          rel="noopener noreferrer"
          color="blue.500"
          href={packageJson.info.author.email[0]}
          onClick={(e) => {
            e.preventDefault();
            open(`mailto:${packageJson.info.author.email[0]}`);
          }}
        >
          {packageJson.info.author.email[0]}
        </Link>
      </Text>
    </Box>
  );
}
