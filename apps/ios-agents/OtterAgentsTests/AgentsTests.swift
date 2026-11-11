import Foundation
import Testing
@testable import Otter_Agents

@MainActor
struct AgentsTests {
    @Test func openClawAgentsAreThereBeforeTheGatewayAnswers() throws {
        let file = Agents.openClawAgentsFile
        let before = try? Data(contentsOf: file)
        defer {
            if let before { try? before.write(to: file) } else { try? FileManager.default.removeItem(at: file) }
        }
        let listed = [OpenClaw.GatewayAgent(id: "main", name: "Rowan", isDefault: true, emoji: "🦊", avatar: "data:image/png;base64,AAAA")]
        try JSONEncoder().encode(listed).write(to: file)

        let agents = Agents()
        #expect(agents.name(of: "openclaw", agent: "main") == "Rowan")
        #expect(agents.openClawFaces["main"]?.avatar == "data:image/png;base64,AAAA")
        #expect(agents.openClawFaces["main"]?.emoji == "🦊")
    }
}
