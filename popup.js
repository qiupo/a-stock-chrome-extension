class StockExtension {
  constructor() {
    this.userStocks = [];
    this.init();
  }

  async init() {
    await this.loadUserStocks();
    this.bindEvents();
    this.loadData();
    this.startAutoRefresh();
  }

  bindEvents() {
    document
      .getElementById("refreshBtn")
      .addEventListener("click", () => this.loadData());
    document
      .getElementById("addStock")
      .addEventListener("click", () => this.addStock());
    document.getElementById("stockSearch").addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.addStock();
    });

    // 绑定删除按钮事件（使用事件委托）
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("remove-btn")) {
        const stockCode = e.target.getAttribute("data-stock-code");
        this.removeStock(stockCode);
      }
    });

    // 绑定视图切换按钮事件
    document
      .getElementById("gridViewBtn")
      .addEventListener("click", () => this.switchView("grid"));
    document
      .getElementById("listViewBtn")
      .addEventListener("click", () => this.switchView("list"));

    // 初始化视图模式
    this.currentView = "grid";
    // 设置初始容器样式
    document.getElementById("myStocks").className = "my-stocks-grid";
    // 设置初始按钮状态
    document.getElementById("gridViewBtn").classList.add("active");

    // 绑定拖拽事件
    this.bindDragEvents();
  }

  async loadUserStocks() {
    try {
      const result = await chrome.storage.local.get(["userStocks"]);
      this.userStocks = result.userStocks || [];
    } catch (error) {
      console.error("加载用户股票失败:", error);
      this.userStocks = [];
    }
  }

  async saveUserStocks() {
    try {
      await chrome.storage.local.set({ userStocks: this.userStocks });
    } catch (error) {
      console.error("保存用户股票失败:", error);
    }
  }

  async loadData() {
    await Promise.all([this.loadIndices(), this.loadStocks()]);
    this.updateTime();
  }

  async loadIndices() {
    const indices = [
      { code: "sh000001", name: "上证指数" },
      { code: "sz399001", name: "深证成指" },
      { code: "sz399006", name: "创业板指" },
      { code: "sh000300", name: "沪深300" },
    ];

    try {
      const indicesData = await this.fetchStockData(
        indices.map((item) => item.code)
      );
      this.displayIndices(indices, indicesData);
    } catch (error) {
      console.error("获取指数数据失败:", error);
      document.getElementById("indices").innerHTML =
        '<div class="error">获取指数数据失败</div>';
    }
  }

  async loadStocks() {
    this.loadMyStocks();
  }

  async loadMyStocks() {
    if (this.userStocks.length === 0) {
      document.getElementById("myStocks").innerHTML =
        '<div class="empty-hint">🎯 还没有添加股票<br/>试试添加几个代码：600519,000858,300750</div>';
      return;
    }

    try {
      const stocksData = await this.fetchStockData(this.userStocks);
      // 对于那些名称显示不正确的股票，尝试单独获取名称
      await this.enhanceStockNames(stocksData);
      this.displayMyStocks(this.userStocks, stocksData);
    } catch (error) {
      console.error("获取用户股票数据失败:", error);
      document.getElementById("myStocks").innerHTML =
        '<div class="error">获取股票数据失败</div>';
    }
  }

  async fetchStockData(codes) {
    // 统一处理股票代码格式
    const normalizedCodes = codes.map((code) => {
      if (code.startsWith("sh") || code.startsWith("sz")) {
        return code;
      }
      // 处理六位数字代码
      if (code.length === 6) {
        return code.startsWith("6") ? `sh${code}` : `sz${code}`;
      }
      return code;
    });
    
    const sinaCodeStr = normalizedCodes.join(",");

    // 优先级1: 尝试东方财富API (通常更快)
    try {
      const eastmoneyResult = await this.fetchFromEastmoney(normalizedCodes);
      if (Object.keys(eastmoneyResult).length > 0) {
        console.log("使用东方财富API获取股票数据，成功解析", Object.keys(eastmoneyResult).length, "只股票");
        return eastmoneyResult;
      }
    } catch (error) {
      console.log("东方财富API失败，尝试新浪API:", error.message);
    }

    // 优先级2: 新浪API - 通常中文名称更准确
      try {
        const sinaUrl = `https://hq.sinajs.cn/list=${sinaCodeStr}`;
        // console.log('请求新浪API:', sinaUrl);
        
        // 添加超时控制，3秒超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const sinaResponse = await fetch(sinaUrl, {
          method: "GET",
          headers: {
            Accept: "text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://finance.sina.com.cn",
          },
          mode: "cors",
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);

        if (sinaResponse.ok) {
          // 尝试用不同编码解析
          const buffer = await sinaResponse.arrayBuffer();
          let sinaText;
          
          try {
            // 首先尝试 UTF-8
            sinaText = new TextDecoder('utf-8').decode(buffer);
          } catch (e) {
            try {
              // 如果失败，尝试 GBK
              sinaText = new TextDecoder('gbk').decode(buffer);
            } catch (e2) {
              // 最后回退到默认
              sinaText = await sinaResponse.text();
            }
          }
          
          const sinaResult = this.parseSinaStockData(sinaText);
          if (Object.keys(sinaResult).length > 0) {
            console.log("使用新浪API获取股票数据，成功解析", Object.keys(sinaResult).length, "只股票");
            return sinaResult;
          }
        }
      } catch (error) {
        console.log("新浪API失败，尝试腾讯API:", error.message);
      }

          // 如果新浪API失败，回退到腾讯API
      try {
        const tencentUrl = `https://qt.gtimg.cn/q=${sinaCodeStr}`;
        // console.log('请求腾讯API:', tencentUrl);
        
        // 腾讯API也添加2秒超时
        const tencentController = new AbortController();
        const tencentTimeoutId = setTimeout(() => tencentController.abort(), 2000);
        
        const tencentResponse = await fetch(tencentUrl, {
          method: "GET",
          headers: {
            Accept: "text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          mode: "cors",
          signal: tencentController.signal,
        });
        
        clearTimeout(tencentTimeoutId);

        if (!tencentResponse.ok) {
          throw new Error(
            `HTTP ${tencentResponse.status}: ${tencentResponse.statusText}`
          );
        }

        // 尝试用不同编码解析腾讯API
        const buffer = await tencentResponse.arrayBuffer();
        let tencentText;
        
        try {
          // 腾讯API通常是 GBK 编码
          tencentText = new TextDecoder('gbk').decode(buffer);
        } catch (e) {
          try {
            // 如果失败，尝试 UTF-8
            tencentText = new TextDecoder('utf-8').decode(buffer);
          } catch (e2) {
            // 最后回退到默认
            tencentText = await tencentResponse.text();
          }
        }

        console.log("使用腾讯API获取股票数据");
        const result = this.parseTencentStockData(tencentText);
        console.log("腾讯API成功解析", Object.keys(result).length, "只股票");
        return result;
      } catch (error) {
        console.error("所有API都失败了:", error);
        throw error;
      }
  }

  // 解析新浪财经API数据
  parseSinaStockData(data) {
    const lines = data.split("\n").filter((line) => line.trim());
    const stocks = {};

    lines.forEach((line) => {
      const match = line.match(/var hq_str_(.+?)="(.+?)"/);
      if (match) {
        const code = match[1];
        const info = match[2].split(",");

        if (info.length >= 32) {
          // 新浪API数据格式：名称,今开,昨收,现价,最高,最低,...
          const stockName = info[0].trim();
          const currentPrice = parseFloat(info[3]) || 0;
          const prevClose = parseFloat(info[2]) || 0;
          const change = currentPrice - prevClose;
          const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

          // 检查股票名称和价格是否有效
          if (stockName && stockName !== "" && !stockName.includes("N/A") && currentPrice > 0) {
            console.log(`新浪API解析: ${code} -> "${stockName}" 价格:${currentPrice}`);
            stocks[code] = {
              name: stockName,
              price: currentPrice,
              change: change,
              changePercent: changePercent,
              volume: info[8] || "0",
              turnover: info[9] || "0",
            };
          } else {
            console.warn(`新浪API数据问题: ${code} -> 名称="${stockName}", 价格=${currentPrice}`);
          }
        }
      }
    });

    console.log(`新浪API成功解析 ${Object.keys(stocks).length} 只股票`);
    return stocks;
  }

  // 解析腾讯财经API数据
  parseTencentStockData(data) {
    const lines = data.split("\n").filter((line) => line.trim());
    const stocks = {};

    lines.forEach((line) => {
      const match = line.match(/v_(.+?)="(.+?)"/);
      if (match) {
        const code = match[1];
        const info = match[2].split("~");

        if (info.length > 50) {
          // 腾讯API数据格式: 0未知,1名称,2代码,3当前价格,4昨收,5今开,6成交量...
          let stockName = info[1];
          const currentPrice = parseFloat(info[3]) || 0;
          const prevClose = parseFloat(info[4]) || 0;
          const change = currentPrice - prevClose;
          const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

          // 检查名称和价格是否有效
          if (stockName && stockName !== "" && !stockName.includes("N/A") && currentPrice > 0) {
            console.log(`腾讯API解析: ${code} -> "${stockName}" 价格:${currentPrice}`);
            stocks[code] = {
              name: stockName,
              price: currentPrice,
              change: change,
              changePercent: changePercent,
              volume: info[6] || "0",
              turnover: info[37] || "0", // 腾讯API的成交额在第37位
            };
          } else {
            console.warn(`腾讯API数据问题: ${code} -> 名称="${stockName}", 价格=${currentPrice}`);
          }
        }
      }
    });

    console.log(`腾讯API成功解析 ${Object.keys(stocks).length} 只股票`);
    return stocks;
  }

  // 备用股票名称获取
  getStockNameFallback(code) {
    // 只保留最核心的指数映射
    const coreStocks = {
      sh000001: "上证指数",
      sz399001: "深证成指", 
      sz399006: "创业板指",
      sh000300: "沪深300",
    };

    // 如果是核心指数，返回名称；否则返回原始代码
    return coreStocks[code] || code.replace(/^(sh|sz)/, "");
  }

  // 尝试通过搜索API获取股票名称
  async fetchStockName(code) {
    try {
      const cleanCode = code.replace(/^(sh|sz)/, "");
      const url = `https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=${cleanCode}`;

      const response = await fetch(url, {
        headers: {
          Referer: "https://finance.sina.com.cn",
        },
      });
      const text = await response.text();

      // 解析搜索结果
      const matches = text.match(/="(.+?)"/);
      if (matches && matches[1]) {
        const suggestions = matches[1].split(";");
        for (const suggestion of suggestions) {
          const parts = suggestion.split(",");
          if (parts.length >= 5) {
            const resultCode = parts[3];
            if (resultCode && (resultCode.includes(cleanCode) || cleanCode.includes(resultCode))) {
              return parts[4]; // 返回股票名称
            }
          }
        }
      }
    } catch (error) {
      console.log("搜索股票名称失败:", error);
    }

    return null;
  }

  // 增强股票名称显示 - 对于API解析失败的股票尝试其他方法
  async enhanceStockNames(stocksData) {
    const promises = Object.keys(stocksData).map(async (code) => {
      const stock = stocksData[code];
      // 只有当股票名称明显不正确时才尝试增强
      if (!stock.name || stock.name === code || /^\d{6}/.test(stock.name)) {
        const properName = await this.fetchStockName(code);
        if (properName && properName !== stock.name) {
          stock.name = properName;
          console.log(`增强股票名称: ${code} -> ${properName}`);
        }
      }
    });

    // 等待所有名称获取完成
    await Promise.all(promises);
  }

  displayIndices(indices, data) {
    const container = document.getElementById("indices");

    if (Object.keys(data).length === 0) {
      container.innerHTML = '<div class="error">暂无指数数据</div>';
      return;
    }

    const html = indices
      .map((index) => {
        const stockData = data[index.code];
        if (!stockData) return "";

        const isUp = stockData.change >= 0;
        const changeClass = isUp ? "up" : "down";
        const changeSymbol = isUp ? "+" : "";

        return `
                <div class="index-item">
                    <div class="index-name">${index.name}</div>
                    <div class="index-price ${changeClass}">${stockData.price.toFixed(
          2
        )}</div>
                    <div class="index-change ${changeClass}">
                        ${changeSymbol}${stockData.change.toFixed(
          2
        )} (${changeSymbol}${stockData.changePercent.toFixed(2)}%)
                    </div>
                </div>
            `;
      })
      .join("");

    container.innerHTML = html;
  }

  displayMyStocks(codes, data) {
    const container = document.getElementById("myStocks");

    if (Object.keys(data).length === 0) {
      container.innerHTML =
        '<div class="empty-hint">🎯 还没有添加股票<br/>试试添加几个代码：600519,000858,300750</div>';
      return;
    }

    const html = codes
      .map((code) => {
        const normalizedCode = this.normalizeStockCode(code);
        const stockData = data[normalizedCode];
        if (!stockData) return "";

        const isUp = stockData.change >= 0;
        const changeClass = isUp ? "up" : "down";
        const changeSymbol = isUp ? "+" : "";

        // 统一HTML结构，通过CSS控制布局差异
        const itemClass = this.currentView === "grid" ? "grid-item" : "list-item";
        return `
                    <div class="my-stock-item ${itemClass}" draggable="true" data-stock-code="${code}">
                        <div class="drag-handle">⋮⋮</div>
                        <div class="stock-content">
                            <div class="stock-name">${stockData.name} <span class="stock-code">(${code})</span></div>
                            <div class="stock-price ${changeClass}">${stockData.price.toFixed(2)}</div>
                            <div class="stock-change ${changeClass}">
                                ${changeSymbol}${stockData.change.toFixed(2)} (${changeSymbol}${stockData.changePercent.toFixed(2)}%)
                            </div>
                        </div>
                        <button class="remove-btn" data-stock-code="${code}">×</button>
                    </div>
                `;
      })
      .join("");

    container.innerHTML = html;
  }

  switchView(viewType) {
    this.currentView = viewType;
    const container = document.getElementById("myStocks");

    // 更新按钮状态
    document
      .getElementById("gridViewBtn")
      .classList.toggle("active", viewType === "grid");
    document
      .getElementById("listViewBtn")
      .classList.toggle("active", viewType === "list");

    // 立即更新容器样式，无需重新获取数据
    if (viewType === "grid") {
      container.className = "my-stocks-grid";
    } else {
      container.className = "my-stocks-list";
    }

    // 更新现有股票项目的样式类
    const stockItems = container.querySelectorAll('.my-stock-item');
    stockItems.forEach(item => {
      if (viewType === "grid") {
        item.classList.remove("list-item");
        item.classList.add("grid-item");
      } else {
        item.classList.remove("grid-item");
        item.classList.add("list-item");
      }
    });
  }

  showSuccessMessage(codes) {
    // 创建成功提示
    const message =
      codes.length === 1
        ? `✅ 成功添加：${codes[0]}`
        : `✅ 成功添加 ${codes.length} 只股票：${codes.join(", ")}`;

    // 临时显示成功消息
    const container = document.getElementById("myStocks");
    const successDiv = document.createElement("div");
    successDiv.style.cssText = `
            position: fixed;
            top: 50px;
            left: 50%;
            transform: translateX(-50%);
            background: #48bb78;
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 12px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(72, 187, 120, 0.3);
        `;
    successDiv.textContent = message;
    document.body.appendChild(successDiv);

    // 2秒后移除提示
    setTimeout(() => {
      if (successDiv.parentNode) {
        successDiv.parentNode.removeChild(successDiv);
      }
    }, 2000);
  }

  bindDragEvents() {
    // 使用事件委托绑定拖拽事件
    document.addEventListener("dragstart", (e) => {
      if (e.target.classList.contains("my-stock-item")) {
        e.target.classList.add("dragging");
        e.dataTransfer.setData("text/plain", e.target.dataset.stockCode);
        e.dataTransfer.effectAllowed = "move";
      }
    });

    document.addEventListener("dragend", (e) => {
      if (e.target.classList.contains("my-stock-item")) {
        e.target.classList.remove("dragging");
        // 清除所有拖拽样式
        document.querySelectorAll(".my-stock-item").forEach((item) => {
          item.classList.remove("drag-over");
        });
      }
    });

    document.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.target.closest(".my-stock-item")) {
        e.dataTransfer.dropEffect = "move";
      }
    });

    document.addEventListener("dragenter", (e) => {
      if (e.target.closest(".my-stock-item")) {
        e.target.closest(".my-stock-item").classList.add("drag-over");
      }
    });

    document.addEventListener("dragleave", (e) => {
      if (e.target.closest(".my-stock-item")) {
        e.target.closest(".my-stock-item").classList.remove("drag-over");
      }
    });

    document.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetItem = e.target.closest(".my-stock-item");
      if (targetItem) {
        targetItem.classList.remove("drag-over");
        const draggedCode = e.dataTransfer.getData("text/plain");
        const targetCode = targetItem.dataset.stockCode;

        if (draggedCode !== targetCode) {
          this.reorderStocks(draggedCode, targetCode);
        }
      }
    });
  }

  async reorderStocks(draggedCode, targetCode) {
    const draggedIndex = this.userStocks.indexOf(draggedCode);
    const targetIndex = this.userStocks.indexOf(targetCode);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      // 移除被拖拽的元素
      const [draggedStock] = this.userStocks.splice(draggedIndex, 1);
      // 插入到目标位置
      this.userStocks.splice(targetIndex, 0, draggedStock);

      // 立即更新DOM顺序，无需重新获取数据
      this.reorderStockItems(draggedCode, targetCode);
      
      // 后台保存新顺序
      this.saveUserStocks().catch(error => {
        console.error("保存股票顺序失败:", error);
      });
    }
  }

  reorderStockItems(draggedCode, targetCode) {
    const container = document.getElementById("myStocks");
    const allItems = Array.from(container.querySelectorAll('.my-stock-item'));
    
    // 按照新的股票顺序重新排列DOM元素
    this.userStocks.forEach(stockCode => {
      const element = allItems.find(item => item.dataset.stockCode === stockCode);
      if (element) {
        container.appendChild(element); // 移动到容器末尾，按顺序排列
      }
    });
  }

  async fetchFromEastmoney(codes) {
    try {
      // 东方财富的格式：0.000001,1.600519 (0=深市，1=沪市)
      const eastmoneyCodes = codes.map(code => {
        if (code.startsWith("sh")) {
          return "1." + code.substring(2);
        } else if (code.startsWith("sz")) {
          return "0." + code.substring(2);
        }
        return code;
      }).join(",");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f14&secids=${eastmoneyCodes}`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        mode: "cors",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const result = {};
        
        if (data.data && data.data.diff) {
          data.data.diff.forEach(item => {
            const code = item.f12;
            const normalizedCode = code.startsWith("6") ? `sh${code}` : `sz${code}`;
            const currentPrice = item.f2 || 0; // 当前价格
            const changePercent = item.f3 || 0; // 涨跌幅百分比
            const change = item.f4 || 0; // 涨跌额（直接使用，不需要计算）
            
            result[normalizedCode] = {
              name: item.f14 || code,
              price: currentPrice,
              change: change,
              changePercent: changePercent,
            };
          });
        }
        
        return result;
      }
    } catch (error) {
      console.log("东方财富API请求失败:", error.message);
    }
    return {};
  }

  normalizeStockCode(code) {
    if (code.startsWith("sh") || code.startsWith("sz")) {
      return code;
    }
    if (code.length === 6) {
      return code.startsWith("6") ? `sh${code}` : `sz${code}`;
    }
    return code;
  }

  async addStock() {
    const input = document.getElementById("stockSearch");
    const inputValue = input.value.trim();

    if (!inputValue) return;

    // 支持批量添加，用逗号分隔
    const codes = inputValue
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code);
    const validCodes = [];
    const errorCodes = [];
    const duplicateCodes = [];

    codes.forEach((code) => {
      // 验证股票代码格式
      if (!/^\d{6}$/.test(code)) {
        errorCodes.push(code);
        return;
      }

      // 检查是否已存在
      if (this.userStocks.includes(code)) {
        duplicateCodes.push(code);
        return;
      }

      validCodes.push(code);
    });

    // 显示添加结果
    if (errorCodes.length > 0) {
      alert(`以下代码格式不正确，请输入6位数字：\n${errorCodes.join(", ")}`);
    }

    if (duplicateCodes.length > 0) {
      alert(`以下股票已存在：\n${duplicateCodes.join(", ")}`);
    }

    if (validCodes.length > 0) {
      this.userStocks.push(...validCodes);
      await this.saveUserStocks();
      input.value = "";
      this.loadMyStocks();

      // 显示成功消息
      this.showSuccessMessage(validCodes);
    }
  }

  async removeStock(code) {
    this.userStocks = this.userStocks.filter((stock) => stock !== code);
    await this.saveUserStocks();
    this.loadMyStocks(); // 只刷新用户股票区域
  }

  updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    document.getElementById("updateTime").textContent = timeStr;
  }

  startAutoRefresh() {
    // 每30秒自动刷新一次
    setInterval(() => {
      this.loadData();
    }, 30000);
  }
}

// 全局实例
let stockExtension;

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", () => {
  stockExtension = new StockExtension();
});
