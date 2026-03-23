// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HSPSimulator
 * @notice HashKey Stream Protocol 支付事件模拟器（测试网演示用）
 *
 * 设计原则：
 *  - 非托管（Non-custodial）：合约不持有任何资金
 *  - 事件驱动：仅发射链上事件，实际 USDC 转账由 ERC-20 transfer 独立完成
 *  - 无权限：任何人均可调用（测试网演示）
 *
 * 典型调用流程：
 *  1. 后端解析用户意图 → build_hsp_message 生成 streamId
 *  2. 调用 requestPayment → 触发 PaymentRequested 事件（链上记录意图）
 *  3. 后端发送 USDC transfer → 获得 txHash
 *  4. 调用 confirmPayment → 触发 Confirmed + Receipt 事件（链上确认）
 *
 * 部署网络：HashKey Chain Testnet (Chain ID: 133)
 * RPC：https://testnet.hsk.xyz
 * USDC (官方测试网)：0x703A0B94A49F765107e3e4abEB4FC3E5bac7248f
 */
contract HSPSimulator {

    // ─── 事件定义 ─────────────────────────────────────────────────────────

    /**
     * @notice 支付意图已提交
     * @param streamId   全局唯一流 ID（由后端 build_hsp_message 生成）
     * @param sender     发起方地址
     * @param receiver   收款方地址
     * @param amount     转账金额（USDC，6 位小数，如 100 USDC = 100_000_000）
     * @param currency   币种标识（如 "USDC"）
     */
    event PaymentRequested(
        bytes32 indexed streamId,
        address indexed sender,
        address indexed receiver,
        uint256 amount,
        string currency
    );

    /**
     * @notice USDC 转账已完成确认
     * @param streamId   对应的流 ID
     * @param sender     发起方地址
     * @param receiver   收款方地址
     * @param amount     实际转账金额（同 PaymentRequested）
     */
    event Confirmed(
        bytes32 indexed streamId,
        address indexed sender,
        address indexed receiver,
        uint256 amount
    );

    /**
     * @notice 支付回执（可用于链上审计）
     * @param streamId   对应的流 ID
     * @param txHash     USDC ERC-20 transfer 的交易哈希
     * @param timestamp  确认时间（Unix 秒）
     */
    event Receipt(
        bytes32 indexed streamId,
        bytes32 txHash,
        uint64 timestamp
    );

    // ─── 状态存储（可选，便于查询） ────────────────────────────────────────

    struct PaymentInfo {
        address sender;
        address receiver;
        uint256 amount;
        string currency;
        bool confirmed;
        bytes32 txHash;
    }

    /// @notice streamId → 支付信息
    mapping(bytes32 => PaymentInfo) public payments;

    // ─── 函数 ─────────────────────────────────────────────────────────────

    /**
     * @notice 提交支付意图，触发 PaymentRequested 事件
     * @param streamId   唯一流 ID（bytes32，由后端生成）
     * @param receiver   收款方 0x 地址
     * @param amount     USDC 金额（6 位小数，如 50 USDC = 50_000_000）
     * @param currency   币种字符串（如 "USDC"）
     */
    function requestPayment(
        bytes32 streamId,
        address receiver,
        uint256 amount,
        string calldata currency
    ) external {
        require(receiver != address(0), "HSP: invalid receiver");
        require(amount > 0, "HSP: amount must be > 0");
        require(payments[streamId].sender == address(0), "HSP: streamId already used");

        payments[streamId] = PaymentInfo({
            sender: msg.sender,
            receiver: receiver,
            amount: amount,
            currency: currency,
            confirmed: false,
            txHash: bytes32(0)
        });

        emit PaymentRequested(streamId, msg.sender, receiver, amount, currency);
    }

    /**
     * @notice 确认支付已完成，触发 Confirmed + Receipt 事件
     * @param streamId   对应 requestPayment 的 streamId
     * @param txHash     USDC ERC-20 transfer 交易的哈希
     */
    function confirmPayment(
        bytes32 streamId,
        bytes32 txHash
    ) external {
        PaymentInfo storage info = payments[streamId];
        require(info.sender != address(0), "HSP: unknown streamId");
        require(!info.confirmed, "HSP: already confirmed");
        require(txHash != bytes32(0), "HSP: invalid txHash");

        info.confirmed = true;
        info.txHash = txHash;

        emit Confirmed(streamId, info.sender, info.receiver, info.amount);
        emit Receipt(streamId, txHash, uint64(block.timestamp));
    }

    /**
     * @notice 查询支付状态
     * @param streamId  流 ID
     * @return sender    发起方
     * @return receiver  收款方
     * @return amount    金额
     * @return currency  币种
     * @return confirmed 是否已确认
     * @return txHash    转账交易哈希（未确认时为 0）
     */
    function getPayment(bytes32 streamId) external view returns (
        address sender,
        address receiver,
        uint256 amount,
        string memory currency,
        bool confirmed,
        bytes32 txHash
    ) {
        PaymentInfo storage info = payments[streamId];
        return (info.sender, info.receiver, info.amount, info.currency, info.confirmed, info.txHash);
    }
}
