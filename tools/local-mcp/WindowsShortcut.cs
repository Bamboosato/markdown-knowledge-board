using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

// WScript.Shell can replace non-ACP characters with '?' on English Windows.
// Use IShellLinkW and IPersistFile so both link paths and targets stay Unicode.
public static class MkbWindowsShortcut
{
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, IntPtr data, uint flags);
        void GetIDList(out IntPtr list);
        void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int count);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int count);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetHotkey(out short key);
        void SetHotkey(short key);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    public sealed class Info
    {
        public string TargetPath { get; set; }
        public string Arguments { get; set; }
        public string IconLocation { get; set; }
    }

    public static Info Read(string path)
    {
        object instance = new ShellLink();
        try
        {
            ((IPersistFile)instance).Load(path, 0);
            IShellLinkW link = (IShellLinkW)instance;
            StringBuilder target = new StringBuilder(32768);
            StringBuilder arguments = new StringBuilder(32768);
            StringBuilder icon = new StringBuilder(32768);
            int iconIndex;
            link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
            link.GetArguments(arguments, arguments.Capacity);
            link.GetIconLocation(icon, icon.Capacity, out iconIndex);
            return new Info { TargetPath = target.ToString(), Arguments = arguments.ToString(), IconLocation = icon.ToString() };
        }
        finally { Marshal.FinalReleaseComObject(instance); }
    }

    public static void Write(string path, string target, string arguments, string directory, string description, string icon)
    {
        object instance = new ShellLink();
        try
        {
            IShellLinkW link = (IShellLinkW)instance;
            link.SetPath(target);
            link.SetArguments(arguments);
            link.SetWorkingDirectory(directory);
            link.SetDescription(description);
            link.SetShowCmd(1);
            if (!String.IsNullOrEmpty(icon)) link.SetIconLocation(icon, 0);
            ((IPersistFile)instance).Save(path, true);
        }
        finally { Marshal.FinalReleaseComObject(instance); }
    }
}
