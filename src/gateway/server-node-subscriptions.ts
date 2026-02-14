export type NodeSendEventFn = (opts: {
  nodeId: string;
  event: string;
  payloadJSON?: string | null;
}) => void;

export type NodeListConnectedFn = () => Array<{ nodeId: string }>;

export type NodeSubscriptionManager = {
  subscribe: (nodeId: string, sessionKey: string) => void;
  unsubscribe: (nodeId: string, sessionKey: string) => void;
  unsubscribeAll: (nodeId: string) => void;
  sendToSession: (
    sessionKey: string,
    event: string,
    payload: unknown,
    sendEvent?: NodeSendEventFn | null,
  ) => void;
  sendToAllSubscribed: (
    event: string,
    payload: unknown,
    sendEvent?: NodeSendEventFn | null,
  ) => void;
  sendToAllConnected: (
    event: string,
    payload: unknown,
    listConnected?: NodeListConnectedFn | null,
    sendEvent?: NodeSendEventFn | null,
  ) => void;
  clear: () => void;
};

/**
 * 创建节点订阅管理器
 * 
 * 该管理器维护节点与会话之间的订阅关系，并提供订阅、取消订阅、发送事件等核心功能。
 * 节点代表业务实体（如设备、服务），会话代表客户端连接（如WebSocket会话）。
 * 订阅关系是双向索引，可通过节点ID查询订阅了该节点的所有会话，也可通过会话密钥查询该会话订阅的所有节点。
 * @namespace NodeSubscriptionManager
 * @returns 返回包含订阅管理方法的对象
 */
export function createNodeSubscriptionManager(): NodeSubscriptionManager {

  const nodeSubscriptions = new Map<string, Set<string>>();
  const sessionSubscribers = new Map<string, Set<string>>();

  // 将负载对象序列化为JSON字符串
  const toPayloadJSON = (payload: unknown) => (payload ? JSON.stringify(payload) : null);

  /** 
   * 订阅指定节点
   * @param nodeId - 节点标识符
   * @param sessionKey - 会话密钥
   */
  const subscribe = (nodeId: string, sessionKey: string) => {
    const normalizedNodeId = nodeId.trim();
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedNodeId || !normalizedSessionKey) {
      return;
    }

    // 更新节点订阅集合
    let nodeSet = nodeSubscriptions.get(normalizedNodeId);
    if (!nodeSet) {
      nodeSet = new Set<string>();
      nodeSubscriptions.set(normalizedNodeId, nodeSet);
    }
    if (nodeSet.has(normalizedSessionKey)) {
      return;
    }
    nodeSet.add(normalizedSessionKey);

    // 更新会话订阅集合
    let sessionSet = sessionSubscribers.get(normalizedSessionKey);
    if (!sessionSet) {
      sessionSet = new Set<string>();
      sessionSubscribers.set(normalizedSessionKey, sessionSet);
    }
    sessionSet.add(normalizedNodeId);
  };

  /**
   * 取消订阅指定节点
   * @param nodeId - 节点标识符
   * @param sessionKey - 会话密钥
   */
  const unsubscribe = (nodeId: string, sessionKey: string) => {
    const normalizedNodeId = nodeId.trim();
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedNodeId || !normalizedSessionKey) {
      return;
    }

    // 从节点订阅集合中移除会话
    const nodeSet = nodeSubscriptions.get(normalizedNodeId);
    nodeSet?.delete(normalizedSessionKey);
    if (nodeSet?.size === 0) {
      nodeSubscriptions.delete(normalizedNodeId);
    }

    // 从会话订阅集合中移除节点
    const sessionSet = sessionSubscribers.get(normalizedSessionKey);
    sessionSet?.delete(normalizedNodeId);
    if (sessionSet?.size === 0) {
      sessionSubscribers.delete(normalizedSessionKey);
    }
  };

  /**
   * 取消指定节点的所有订阅
   * @param nodeId - 节点标识符
   */
  const unsubscribeAll = (nodeId: string) => {
    const normalizedNodeId = nodeId.trim();
    const nodeSet = nodeSubscriptions.get(normalizedNodeId);
    if (!nodeSet) {
      return;
    }

    // 遍历订阅该节点的所有会话，移除对应的反向索引
    for (const sessionKey of nodeSet) {
      const sessionSet = sessionSubscribers.get(sessionKey);
      sessionSet?.delete(normalizedNodeId);
      if (sessionSet?.size === 0) {
        sessionSubscribers.delete(sessionKey);
      }
    }

    // 删除节点本身的订阅集合
    nodeSubscriptions.delete(normalizedNodeId);
  };

  /**
   * 向指定会话所订阅的所有节点发送事件
   * @param sessionKey - 目标会话密钥
   * @param event - 事件名称
   * @param payload - 事件负载（将被序列化为JSON字符串）
   * @param sendEvent - 实际发送事件的回调函数，若为null或undefined则跳过发送
   */
  const sendToSession = (
    sessionKey: string,
    event: string,
    payload: unknown,
    sendEvent?: NodeSendEventFn | null,
  ) => {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey || !sendEvent) {
      return;
    }

    const subs = sessionSubscribers.get(normalizedSessionKey);
    if (!subs || subs.size === 0) {
      return;
    }

    const payloadJSON = toPayloadJSON(payload);
    for (const nodeId of subs) {
      sendEvent({ nodeId, event, payloadJSON });
    }
  };

  /**
   * 向所有被至少一个会话订阅的节点发送事件
   * @param event - 事件名称
   * @param payload - 事件负载（将被序列化为JSON字符串）
   * @param sendEvent - 实际发送事件的回调函数，若为null或undefined则跳过发送
   */
  const sendToAllSubscribed = (
    event: string,
    payload: unknown,
    sendEvent?: NodeSendEventFn | null,
  ) => {
    if (!sendEvent) {
      return;
    }

    const payloadJSON = toPayloadJSON(payload);
    for (const nodeId of nodeSubscriptions.keys()) {
      sendEvent({ nodeId, event, payloadJSON });
    }
  };

  /**
   * 向所有当前已连接的节点发送事件（无论是否被订阅）
   * @param event - 事件名称
   * @param payload - 事件负载（将被序列化为JSON字符串）
   * @param listConnected - 获取当前所有已连接节点的回调函数
   * @param sendEvent - 实际发送事件的回调函数
   */
  const sendToAllConnected = (
    event: string,
    payload: unknown,
    listConnected?: NodeListConnectedFn | null,
    sendEvent?: NodeSendEventFn | null,
  ) => {
    if (!sendEvent || !listConnected) {
      return;
    }

    const payloadJSON = toPayloadJSON(payload);
    for (const node of listConnected()) {
      sendEvent({ nodeId: node.nodeId, event, payloadJSON });
    }
  };

  /** 清空所有订阅关系 */
  const clear = () => {
    nodeSubscriptions.clear();
    sessionSubscribers.clear();
  };

  return {
    subscribe,
    unsubscribe,
    unsubscribeAll,
    sendToSession,
    sendToAllSubscribed,
    sendToAllConnected,
    clear,
  };
}