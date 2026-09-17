import { describe, expect, it, vi } from 'vitest';
import { MindmapSettingTab } from '../src/obsidian/settings';

vi.mock('obsidian', () => ({
  PluginSettingTab: class {},
  Setting: class {},
}));

describe('bookmark settings', () => {
  it('confirms and removes every bookmark, then disables the action', async () => {
    const resetBookmarks = vi.fn().mockResolvedValue(undefined);
    const plugin = {
      settings: { bookmarks: [{ id: 'saved' }] },
      resetBookmarks,
    };
    const tab = Object.create(MindmapSettingTab.prototype) as MindmapSettingTab;
    const button = {
      buttonEl: { addClass: vi.fn() },
      setButtonText: vi.fn(),
      setDisabled: vi.fn(),
      onClick: vi.fn(),
    };

    button.setButtonText.mockReturnValue(button);
    button.setDisabled.mockReturnValue(button);
    button.onClick.mockReturnValue(button);
    Object.assign(tab, { plugin });
    const setting = {
      settingEl: { win: { confirm: vi.fn(() => true) } },
      addButton: (add: (value: typeof button) => void) => add(button),
    };
    const addButton = Reflect.get(tab, 'addRemoveBookmarksButton') as (
      this: MindmapSettingTab,
      setting: unknown,
    ) => void;

    addButton.call(tab, setting);
    const click = button.onClick.mock.calls[0]?.[0] as () => void;

    click();
    await vi.waitFor(() => expect(resetBookmarks).toHaveBeenCalledOnce());

    expect(setting.settingEl.win.confirm).toHaveBeenCalledWith(
      'Remove all node bookmarks?',
    );
    expect(button.buttonEl.addClass).toHaveBeenCalledWith('mod-warning');
    expect(button.setDisabled).toHaveBeenNthCalledWith(1, false);
    expect(button.setDisabled).toHaveBeenLastCalledWith(true);
  });
});
