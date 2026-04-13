//
//  WalletAppShortcuts.swift
//  BlueWallet


import AppIntents

@available(iOS 16.4, *)
struct WalletAppShortcuts: AppShortcutsProvider {
    
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PriceIntent(),
            phrases: [
                AppShortcutPhrase<PriceIntent>("Market rate for HashCash in \(\.$fiatCurrency) using ${applicationName}"),
                AppShortcutPhrase<PriceIntent>("Get the current HashCash market rate in \(\.$fiatCurrency) with ${applicationName}"),
                AppShortcutPhrase<PriceIntent>("What's the current HashCash rate in \(\.$fiatCurrency) using ${applicationName}?"),
                AppShortcutPhrase<PriceIntent>("Show me the current HashCash price in \(\.$fiatCurrency) via ${applicationName}"),
                AppShortcutPhrase<PriceIntent>("Retrieve HashCash rate in \(\.$fiatCurrency) from ${applicationName}")
            ],
            shortTitle: "Market Rate",
            systemImageName: "chart.line.uptrend.xyaxis.circle"
        )
        
    }
}
