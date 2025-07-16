// 后台脚本
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('A股行情助手已安装');
        
        // 设置默认配置
        chrome.storage.local.set({
            userStocks: [],
            refreshInterval: 30000,
            notifications: true
        });
    }
});

// 处理网络请求错误
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchStockData') {
        fetchStockDataInBackground(request.url)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // 保持消息通道开放
    }
});

async function fetchStockDataInBackground(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        console.error('后台获取数据失败:', error);
        throw error;
    }
} 