# vkr_project — смарт-контракт VCRegistry

Контрактная часть системы DocumentChain (W3C Verifiable Credentials 2.0).
Полное описание проекта, архитектуры и ролей — в [корневом README](../README.md).

Здесь живут смарт-контракт, тесты и скрипт деплоя.

## Состав

- `contracts/DocumentRegistry.sol` — контракт `VCRegistry`: реестр доверенных эмитентов + отзыв по `credentialId`. PII on-chain не хранится.
- `test/DocumentRegistry.test.js` — тесты контракта (Hardhat + Mocha + Chai).
- `test/vc-layer.test.js` — юнит-тесты VC-слоя (DID, canonicalization, подпись, срок действия).
- `scripts/deploy.js` — деплой `VCRegistry` на Sepolia.

## Команды

```bash
npm install              # установка зависимостей
npx hardhat compile      # компиляция контракта
npm test                 # запуск всех тестов
npx hardhat run scripts/deploy.js   # деплой на Sepolia (сеть берётся из network.create)
```

## Переменные окружения

Создайте `.env` в этой папке (он исключён через `.gitignore`):

```
INFURA_URL=https://sepolia.infura.io/v3/<YOUR_PROJECT_ID>
PRIVATE_KEY=<0x_private_key_of_deployer>
INITIAL_ISSUER=<0x_address_of_first_issuer>
```

После деплоя скопируйте адрес контракта в `website/index.html` (`const contractAddress`).
