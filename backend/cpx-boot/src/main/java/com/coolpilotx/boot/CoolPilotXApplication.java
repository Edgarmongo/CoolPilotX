package com.coolpilotx.boot;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * CoolPilotX 装配根。
 *
 * 这里是唯一的启动入口与组合根：聚合各业务模块的应用服务、web 适配层与 infrastructure 适配器。
 * 业务模块不得反向依赖本模块。
 */
@SpringBootApplication(scanBasePackages = "com.coolpilotx")
public class CoolPilotXApplication {

    public static void main(String[] args) {
        SpringApplication.run(CoolPilotXApplication.class, args);
    }
}
