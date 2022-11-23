using System;
using System.IO;
using System.IO.Compression;

class Program
{
	static void Main(string[] args)
	{
		string source = string.Empty;
		string destination = string.Empty;
		if (args.Length == 2)
		{
			source = args[0];
			destination = args[1];
		}
		else
		{
			throw new Exception("Please input source and desination.");
		}
		using (FileStream archiveFileStream = new FileStream(source, FileMode.Open, FileAccess.Read))
		using (ZipArchive zipArchive = new ZipArchive(archiveFileStream, ZipArchiveMode.Read, false))
		{
			foreach (ZipArchiveEntry entry in zipArchive.Entries)
			{
			
				string extractPath = Path.Combine(destination, entry.FullName); //add suppression here to test
				entry.ExtractToFile(extractPath);
			}
		}
		return;
	}
}
