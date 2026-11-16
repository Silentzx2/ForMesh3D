import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ComponentProps } from 'react';
import {
  AlertCircleIcon, BoneIcon, BoxIcon,
  Cancel01Icon, ChevronDownIcon, ChevronRightIcon, CpuIcon, Delete02Icon,
  DicesIcon, DownloadIcon, Edit02Icon, EyeIcon, EyeOffIcon, FilmIcon,
  FootprintsIcon, FolderArchiveIcon, GitForkIcon, Grid3X3Icon, LayersIcon,
  Image01Icon, LightbulbIcon, LoaderCircleIcon, MagicWand01Icon, PaletteIcon, PauseIcon,
  PlayIcon, RefreshCwIcon, RepeatIcon, RotateCcwIcon, RotateCwIcon,
  ScissorsIcon, Settings01Icon, ShieldCheckIcon, SlidersHorizontalIcon,
  SparklesIcon, Sun03Icon, ThumbsUpIcon, ZapIcon,
} from '@hugeicons/core-free-icons';

type HugeIconData = ComponentProps<typeof HugeiconsIcon>['icon'];
type IconProps = Omit<ComponentProps<typeof HugeiconsIcon>, 'icon'>;

function component(icon: HugeIconData, name: string): React.FC<IconProps> {
  const Icon: React.FC<IconProps> = props => (
    <HugeiconsIcon icon={icon} {...props} />
  );
  Icon.displayName = name;
  return Icon;
}

export const AlertCircle = component(AlertCircleIcon, 'AlertCircle');
export const Bone = component(BoneIcon, 'Bone');
export const Box = component(BoxIcon, 'Box');
export const CancelIcon = component(Cancel01Icon, 'CancelIcon');
export const ChevronDown = component(ChevronDownIcon, 'ChevronDown');
export const ChevronRight = component(ChevronRightIcon, 'ChevronRight');
export const Cpu = component(CpuIcon, 'Cpu');
export const Dices = component(DicesIcon, 'Dices');
export const Download = component(DownloadIcon, 'Download');
export const Edit2 = component(Edit02Icon, 'Edit2');
export const Eye = component(EyeIcon, 'Eye');
export const EyeOff = component(EyeOffIcon, 'EyeOff');
export const Film = component(FilmIcon, 'Film');
export const FolderArchive = component(FolderArchiveIcon, 'FolderArchive');
export const Footprints = component(FootprintsIcon, 'Footprints');
export const GitFork = component(GitForkIcon, 'GitFork');
export const Grid3X3 = component(Grid3X3Icon, 'Grid3X3');
export const ImageIcon = component(Image01Icon, 'ImageIcon');
export const Layers = component(LayersIcon, 'Layers');
export const Lightbulb = component(LightbulbIcon, 'Lightbulb');
export const Loader2 = component(LoaderCircleIcon, 'Loader2');
export const Palette = component(PaletteIcon, 'Palette');
export const Pause = component(PauseIcon, 'Pause');
export const Play = component(PlayIcon, 'Play');
export const RefreshCw = component(RefreshCwIcon, 'RefreshCw');
export const Repeat = component(RepeatIcon, 'Repeat');
export const RotateCcw = component(RotateCcwIcon, 'RotateCcw');
export const RotateCw = component(RotateCwIcon, 'RotateCw');
export const Scissors = component(ScissorsIcon, 'Scissors');
export const Settings2 = component(Settings01Icon, 'Settings2');
export const ShieldCheck = component(ShieldCheckIcon, 'ShieldCheck');
export const SlidersHorizontal = component(SlidersHorizontalIcon, 'SlidersHorizontal');
export const Sparkles = component(SparklesIcon, 'Sparkles');
export const Sun = component(Sun03Icon, 'Sun');
export const ThumbsUp = component(ThumbsUpIcon, 'ThumbsUp');
export const Trash2 = component(Delete02Icon, 'Trash2');
export const Wand2 = component(MagicWand01Icon, 'Wand2');
export const Zap = component(ZapIcon, 'Zap');
